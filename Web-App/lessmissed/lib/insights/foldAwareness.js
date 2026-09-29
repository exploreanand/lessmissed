import Fixation from "@/lib/models/Fixation";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-S04: Fold Awareness — element-level net visibility, which is the
// product of "did the session scroll far enough" and "given that, did the
// session actually fixate". A CTA at 80% depth might have 30% scroll reach
// and 60% fixation among those who reached it, so its net visibility is 18%.
// The value over any single component (scroll depth or fixation count alone)
// is that it names the fix: low pct_scrolled → drag it up the page or add a
// pointer; low pct_fixated → visual weight problem where it is. SRS §7.2.

// Elements below this depth are the ones the insight is really about — the
// "above the fold" cohort trivially scores 100% on scroll reach and is
// covered by INS-G02 (Element Attention Ranking).
const MIN_BELOW_FOLD_TOP_PCT = 40;

// Elements need to be visible to *someone* to be worth ranking; a below-fold
// element with 0% scroll reach isn't a visibility problem, it's an existence
// question no one has answered.
const MIN_PCT_SCROLLED_FOR_RANKING = 5;

const TOP_N = 5;

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    total_elements: 0,
    below_fold_count: 0,
    fold_depth_pct: null,
    document_height_basis: null,
    worst_net_visibility: [],
    biggest_gap: [],
  };
}

// Takes the lean project doc and page subdoc. project._id must already be an
// ObjectId — Fixation.aggregate does not schema-cast $match.
export async function computeFoldAwareness(project, page) {
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { session_id: 1, "summary.max_scroll_depth_percent": 1 }
  ).lean();

  const totalSessions = sessions.length;
  if (totalSessions === 0) return emptyResult(0);

  // Group fixations by the same identity ladder page.jsx uses, and carry
  // element position: prefer the recorded element_rect (top edge + height),
  // else fall back to the average fixation center — the extension does not
  // always send element_rect, so a fallback is what makes the card render
  // rather than sit empty.
  const grouped = await Fixation.aggregate([
    { $match: { project_id: project._id, ...pageMatchFilter(page) } },
    {
      $group: {
        _id: {
          $ifNull: ["$region_id", { $ifNull: ["$element_key", "$element_id"] }],
        },
        element_id: { $first: "$element_id" },
        element_tag: { $first: "$element_tag" },
        element_text: { $first: "$element_text" },
        element_alt: { $first: "$element_alt" },
        element_aria: { $first: "$element_aria" },
        element_src: { $first: "$element_src" },
        region_id: { $first: "$region_id" },
        rect_y: { $first: "$element_rect.y" },
        rect_h: { $first: "$element_rect.h" },
        avg_center_y: { $avg: "$center_y" },
        session_ids: { $addToSet: "$session_id" },
        fixation_count: { $sum: 1 },
      },
    },
  ]);

  if (grouped.length === 0) return emptyResult(totalSessions);

  const regionById = new Map((page.regions ?? []).map((r) => [r.region_id, r]));

  // Document height — the denominator for element position. If the screenshot
  // metadata is missing we fall back to the observed max y across fixations,
  // same convention INS-G04 and INS-G08 use.
  const screenshotDocH = page.screenshot_document_height || null;
  const foldPx = page.screenshot_viewport_height || null;
  const observedMaxY = Math.max(
    ...grouped.map((g) => Math.max(g.avg_center_y ?? 0, g.rect_y ?? 0)),
    1
  );
  const docHeight = screenshotDocH || observedMaxY;
  const basis = screenshotDocH ? "screenshot" : "observed";

  // Fold as a fraction of the document. Without both screenshot dims we can
  // still compute per-element net visibility — the fold-specific highlighting
  // just isn't meaningful, so we hide it downstream.
  const foldPct =
    screenshotDocH && foldPx
      ? Math.round((foldPx / screenshotDocH) * 100)
      : null;

  // Session id → max scroll depth (0–100). Coerce nulls to 0: a session with
  // no scroll data behaved like one that never scrolled, which is the honest
  // reading — the alternative of dropping such sessions would inflate reach.
  const sessionMaxScroll = new Map();
  for (const s of sessions) {
    sessionMaxScroll.set(s.session_id, s.summary?.max_scroll_depth_percent ?? 0);
  }

  const elements = [];
  for (const g of grouped) {
    // Overlays are instrumentation, not content. A region-labelled row is
    // never an overlay — regions come from the page-region editor.
    if (!regionById.has(g._id) && isInstrumentElement(g.element_id)) continue;

    const region = regionById.get(g._id);
    const label = region?.label ?? describeElement(g).label;

    const yPx =
      g.rect_y != null && Number.isFinite(g.rect_y)
        ? g.rect_y
        : g.avg_center_y ?? 0;
    const heightPx = g.rect_h != null && Number.isFinite(g.rect_h) ? g.rect_h : 0;

    const topPct = Math.min(
      100,
      Math.max(0, Math.round((yPx / docHeight) * 100))
    );
    const bottomPct = Math.min(
      100,
      Math.max(topPct, Math.round(((yPx + heightPx) / docHeight) * 100))
    );

    // A session "scrolled to" the element when its viewport bottom passed the
    // element's top edge — i.e. max_scroll_depth_percent >= topPct.
    let sessionsScrolled = 0;
    for (const ms of sessionMaxScroll.values()) {
      if (ms >= topPct) sessionsScrolled += 1;
    }

    const fixationSessions = new Set(g.session_ids);
    // The intersection is what "actually saw" means: fixated AND had scroll
    // reach to see it. A fixation without scroll reach is a data anomaly
    // (mis-attributed to this page, e.g., after path retemplating) and we
    // don't count it toward net visibility.
    let sessionsSawAndFixated = 0;
    for (const sid of fixationSessions) {
      const ms = sessionMaxScroll.get(sid);
      if (ms != null && ms >= topPct) sessionsSawAndFixated += 1;
    }

    const pctScrolled = Math.round((sessionsScrolled / totalSessions) * 100);
    const pctFixateWhenScrolled = sessionsScrolled
      ? Math.round((sessionsSawAndFixated / sessionsScrolled) * 100)
      : 0;
    const pctNetVisibility = Math.round(
      (sessionsSawAndFixated / totalSessions) * 100
    );

    elements.push({
      key: g._id,
      element_id: g.element_id ?? g._id,
      label,
      top_pct: topPct,
      bottom_pct: bottomPct,
      below_fold:
        foldPct != null ? topPct >= foldPct : topPct >= MIN_BELOW_FOLD_TOP_PCT,
      pct_scrolled: pctScrolled,
      pct_fixate_when_scrolled: pctFixateWhenScrolled,
      pct_net_visibility: pctNetVisibility,
      fixation_count: g.fixation_count,
    });
  }

  const belowFold = elements.filter((e) => e.below_fold);

  // Worst net visibility below the fold — the ranked "what are people
  // missing" list. Requires SOME scroll reach so an element no one ever
  // scrolled to (0/0/0) doesn't monopolise the top.
  const worstNetVisibility = belowFold
    .filter((e) => e.pct_scrolled >= MIN_PCT_SCROLLED_FOR_RANKING)
    .sort((a, b) => a.pct_net_visibility - b.pct_net_visibility)
    .slice(0, TOP_N);

  // Biggest scroll-vs-look gap: elements users saw pass their viewport but
  // didn't actually look at. This is the "visibility is not enough" cohort —
  // the content is on screen but doesn't earn a fixation.
  const biggestGap = elements
    .filter((e) => e.pct_scrolled >= 20 && e.pct_net_visibility < e.pct_scrolled)
    .map((e) => ({ ...e, gap_pct: e.pct_scrolled - e.pct_net_visibility }))
    .sort((a, b) => b.gap_pct - a.gap_pct)
    .slice(0, TOP_N);

  return {
    total_sessions: totalSessions,
    total_elements: elements.length,
    below_fold_count: belowFold.length,
    fold_depth_pct: foldPct,
    document_height_basis: basis,
    worst_net_visibility: worstNetVisibility,
    biggest_gap: biggestGap,
  };
}
