import Fixation from "@/lib/models/Fixation";
import Session from "@/lib/models/Session";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-G08: Attention Drop-off Point — the vertical decile where the share of
// sessions that fixated in that band drops below the drop-off threshold. Its
// value over INS-S01 (scroll depth) is precisely the divergence: users scroll
// past content without looking at it, so a page can have 80% scroll-reach at
// the fold and 30% attention at the fold, and only INS-G08 sees the gap. SRS §7.1.

// A fixation shorter than this is a saccade tail, not a real look — same cut
// INS-G04, G05 and G06 use to define a meaningful fixation.
const MIN_FIXATION_MS = 200;

const DECILE_COUNT = 10;

// The threshold the spec calls out: "fixation rate drops below 50%". Kept as a
// constant so it's easy to tune later without hunting through the module.
const DROP_OFF_THRESHOLD_PCT = 50;

function emptyResult(totalSessions) {
  return {
    total_sessions: totalSessions,
    total_fixations: 0,
    document_height_basis: null,
    deciles: [],
    drop_off_decile: null,
    worst_gap: null,
    peak_decile: null,
  };
}

// Takes the lean project doc and page subdoc. Fixation.aggregate does not
// schema-cast $match, so project._id must already be an ObjectId; the page
// subdoc carries the screenshot dimensions needed to bin center_y into deciles.
export async function computeAttentionDropOff(project, page) {
  // Same scoping rule as G04 / G06: only sessions that actually reached this
  // page. Counting project-wide sessions would understate every decile.
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { session_id: 1, summary: 1 }
  ).lean();

  const totalSessions = sessions.length;
  if (totalSessions === 0) return emptyResult(0);

  const fixations = await Fixation.find({
    project_id: project._id,
    ...pageMatchFilter(page),
    duration_ms: { $gte: MIN_FIXATION_MS },
  })
    .select("session_id center_y")
    .lean();

  if (fixations.length === 0) return emptyResult(totalSessions);

  // Document height is the vertical basis for the deciles. We adopt the same
  // fallback G04 uses when the screenshot dimensions have not been captured:
  // normalise to the observed max fixation Y so the card still renders. The
  // scroll-reach comparison is always exact because it uses percentages.
  const screenshotDocH = page.screenshot_document_height || null;
  const observedMaxY = Math.max(...fixations.map((f) => f.center_y), 1);
  const denominator = screenshotDocH || observedMaxY;
  const basis = screenshotDocH ? "screenshot" : "observed";

  // Per-session sets of deciles containing at least one fixation. A session
  // that fixated three times in the same decile counts once for that decile —
  // pct_fixated is defined over distinct sessions, not raw fixations.
  const sessionDeciles = new Map();
  for (const f of fixations) {
    const d = Math.min(
      DECILE_COUNT - 1,
      Math.max(0, Math.floor((f.center_y / denominator) * DECILE_COUNT))
    );
    let set = sessionDeciles.get(f.session_id);
    if (!set) {
      set = new Set();
      sessionDeciles.set(f.session_id, set);
    }
    set.add(d);
  }

  const deciles = Array.from({ length: DECILE_COUNT }, (_, i) => ({
    index: i,
    label: `${i * 10}-${(i + 1) * 10}%`,
    top_pct: i * 10,
    sessions_with_fixation: 0,
    pct_fixated: 0,
    sessions_reached: 0,
    pct_reached: 0,
  }));

  for (const set of sessionDeciles.values()) {
    for (const d of set) deciles[d].sessions_with_fixation++;
  }

  // Scroll reach: a session's max_scroll_depth_percent is the deepest fraction
  // of the document its viewport bottom reached, so it "reached" every decile
  // whose top boundary lies at or above that value. Boundary math: decile i
  // spans [i*10, (i+1)*10]%; reached when max_scroll >= (i+1)*10 gets the top
  // boundary right. A session that scrolled 55% reached deciles 0-4 (0-50%)
  // and partially into decile 5 — we count partial as reached to align with
  // how INS-S01 renders scroll-depth reach in this UI.
  for (const s of sessions) {
    const maxScroll = s.summary?.max_scroll_depth_percent ?? 0;
    for (let i = 0; i < DECILE_COUNT; i++) {
      // "at least touched": include partial coverage of the decile.
      if (maxScroll >= i * 10 + 1) deciles[i].sessions_reached++;
    }
  }

  deciles.forEach((d) => {
    d.pct_fixated = Math.round((d.sessions_with_fixation / totalSessions) * 100);
    d.pct_reached = Math.round((d.sessions_reached / totalSessions) * 100);
  });

  // Peak first, then drop-off. Scanning from the top for the first decile
  // below the threshold fails on pages whose very first decile is empty
  // (padding, sticky nav) — such a decile hasn't "dropped off", nothing was
  // ever there. Start looking after the attention peak instead.
  const peakDecile = [...deciles].sort((a, b) => b.pct_fixated - a.pct_fixated)[0];
  const peak =
    peakDecile && peakDecile.pct_fixated >= DROP_OFF_THRESHOLD_PCT
      ? peakDecile
      : null;

  let dropOff = null;
  if (peak) {
    for (let i = peak.index + 1; i < DECILE_COUNT; i++) {
      if (deciles[i].pct_fixated < DROP_OFF_THRESHOLD_PCT) {
        dropOff = deciles[i];
        break;
      }
    }
  }

  // Biggest scroll-without-looking gap in absolute pp. Only deciles that were
  // actually scrolled to are meaningful — a decile no one reached also had no
  // fixations but the gap there is not the insight we want to surface.
  const gaps = deciles
    .filter((d) => d.pct_reached >= DROP_OFF_THRESHOLD_PCT)
    .map((d) => ({ ...d, gap_pct: d.pct_reached - d.pct_fixated }));
  const worst = gaps.sort((a, b) => b.gap_pct - a.gap_pct)[0];
  const worstGap = worst && worst.gap_pct > 0 ? worst : null;

  return {
    total_sessions: totalSessions,
    total_fixations: fixations.length,
    document_height_basis: basis,
    deciles,
    drop_off_decile: dropOff
      ? {
          index: dropOff.index,
          label: dropOff.label,
          pct_fixated: dropOff.pct_fixated,
          pct_reached: dropOff.pct_reached,
        }
      : null,
    worst_gap: worstGap
      ? {
          index: worstGap.index,
          label: worstGap.label,
          pct_fixated: worstGap.pct_fixated,
          pct_reached: worstGap.pct_reached,
          gap_pct: worstGap.gap_pct,
        }
      : null,
    peak_decile: peak
      ? { index: peak.index, label: peak.label, pct_fixated: peak.pct_fixated }
      : null,
  };
}
