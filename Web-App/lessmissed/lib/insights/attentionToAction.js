import Event from "../models/Event.js";
import Fixation from "../models/Fixation.js";
import Session from "../models/Session.js";
import { describeElement, isInstrumentElement } from "./describeElement.js";
import { pageMatchFilter } from "../pathTemplate.js";

// INS-GC04: Attention-to-Action Ratio — how many sessions had to look at an
// element for one of them to act on it. SRS §7.4: "(sessions with fixation) /
// (sessions with click) per element. Ratio > 10:1 = high friction. < 2:1 =
// high converting."
//
// The denominator is |S_F ∩ S_C|, not |S_C|. Taking every clicking session
// would let an element clicked by sessions that never looked at it score
// better than it deserves — the same trap elements/route.js documents — and
// the intersection is what makes the identity
//
//     A2A = 1 / (1 - LBNC)
//
// hold, so this card and INS-GC01 can never contradict each other. It holds on
// the exact rates: `looked_not_clicked_rate` is rounded to a whole percent for
// display, so recovering the ratio from *that* is only approximate (6 looks
// per action is an 83% rate, and 1/(1-0.83) is 5.88). Both numbers are
// therefore computed from the session counts, never from each other.
// That matters here: GC01 already renders a "friction ratio" headline, and it
// used to compute it by dividing two rounded percentages derived from a bare
// count comparison. Both now come from this module.
//
// Granularity: grouped by `element_key || element_id`, the identity ladder
// C02/C03/C04/GC02/GC03 all use. Fixations can also be grouped by region_id
// (a screenshot-space concept), but click events carry no region, so a
// region-level ratio is not computable — the region's *label* is carried over
// where one exists, so rows still read as components rather than selectors.
//
// Relative imports, no "@/" alias, so tests and scripts can load it.

// "Looked" means the same thing here as in G04-G08, GC02 and GC03: a fixation
// long enough to be a look rather than a saccade tail.
const MIN_FIXATION_MS = 200;

// Both from the spec (SRS §7.4), unlike GC03's bands.
const A2A_FRICTION = 10;
const A2A_CONVERTING = 2;

// An element is ranked only when this many distinct sessions looked at it.
// Same floor as its siblings.
const MIN_SESSIONS_FOR_TOP = 2;

// LBNC above this is what GC01 calls a friction element: more than half the
// sessions that looked did not act.
const LBNC_THRESHOLD_PCT = 50;

const TOP_ELEMENTS = 5;

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function bandFor(ratio) {
  if (ratio == null) return "never_clicked";
  if (ratio < A2A_CONVERTING) return "converting";
  if (ratio > A2A_FRICTION) return "friction";
  return "watch";
}

// One decimal, trailing ".0" dropped, so a clean 4:1 does not read as "4.0:1".
function ratioText(ratio) {
  if (ratio == null) return "∞";
  const s = ratio.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    elements_looked: 0,
    elements_ranked: 0,
    never_clicked_count: 0,
    median_ratio: 0,
    median_ratio_text: "—",
    friction_count: 0,
    converting_count: 0,
    top_elements: [],
    looked_not_clicked: [],
  };
}

// Pure. `fixationGroups` and `clickGroups` are $group output keyed by the
// element ladder, each carrying a `sessions` array of session ids.
export function computeAttentionToActionStats({
  fixationGroups = [],
  clickGroups = [],
  regions = [],
  totalSessions = 0,
} = {}) {
  if (fixationGroups.length === 0) return emptyResult(totalSessions);

  const regionById = new Map((regions ?? []).map((r) => [r.region_id, r]));

  const clickByKey = new Map();
  for (const c of clickGroups) {
    if (!c._id) continue;
    clickByKey.set(c._id, { sessions: new Set(c.sessions ?? []), click_count: c.click_count ?? 0 });
  }

  const rows = [];
  for (const f of fixationGroups) {
    if (!f._id) continue;
    const region = regionById.get(f.region_id);
    // Our own overlay is instrumentation, not the site. A labelled region is
    // kept regardless, matching how the element table filters.
    if (!region && isInstrumentElement(f.element_id)) continue;

    const fixationSessions = new Set(f.sessions ?? []);
    const sessionsWithFixation = fixationSessions.size;
    if (sessionsWithFixation === 0) continue;

    const clicks = clickByKey.get(f._id);
    const clickSessions = clicks?.sessions ?? new Set();
    // S_F ∩ S_C — sessions that both looked at it and clicked it.
    let both = 0;
    for (const id of clickSessions) if (fixationSessions.has(id)) both += 1;

    const ratio = both > 0 ? sessionsWithFixation / both : null;

    rows.push({
      key: f._id,
      element_id: f.element_id ?? f._id,
      label: region?.label ?? describeElement(f).label,
      element_tag: f.element_tag ?? null,
      sessions_with_fixation: sessionsWithFixation,
      sessions_with_click: clickSessions.size,
      sessions_fixated_and_clicked: both,
      click_count: clicks?.click_count ?? 0,
      ratio,
      ratio_text: ratioText(ratio),
      looked_not_clicked_rate: Math.round(
        ((sessionsWithFixation - both) / sessionsWithFixation) * 100
      ),
      band: bandFor(ratio),
      pct_looked: totalSessions > 0 ? Math.round((sessionsWithFixation / totalSessions) * 100) : 0,
      // Of all sessions on the page, the share that looked AND acted. Using
      // `both` rather than |S_C| keeps this consistent with the ratio.
      pct_clicked: totalSessions > 0 ? Math.round((both / totalSessions) * 100) : 0,
    });
  }

  const eligible = rows.filter((r) => r.sessions_with_fixation >= MIN_SESSIONS_FOR_TOP);

  // Elements nobody ever clicked have an infinite ratio. They are INS-GC01's
  // subject, so they are counted here and left out of the ranking rather than
  // pinned to the top of it, where they would crowd out every element that
  // does convert but converts badly.
  const converted = eligible.filter((r) => r.ratio != null);
  const ranked = [...converted].sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    return b.sessions_with_fixation - a.sessions_with_fixation;
  });

  const medianRatio = median(converted.map((r) => r.ratio));

  // GC01's list: more than half the sessions that looked did not act. No
  // session floor, which is the behaviour this list already had — only the
  // arithmetic behind it changes.
  const lookedNotClicked = rows
    .filter((r) => r.looked_not_clicked_rate > LBNC_THRESHOLD_PCT)
    .sort((a, b) => b.pct_looked - a.pct_looked)
    .slice(0, TOP_ELEMENTS)
    .map((r) => ({
      key: r.key,
      element_id: r.element_id,
      label: r.label,
      pct_looked: r.pct_looked,
      pct_clicked: r.pct_clicked,
      lbnc_pct: r.looked_not_clicked_rate,
      ratio: r.ratio,
      ratio_text: r.ratio_text,
    }));

  return {
    total_sessions: totalSessions,
    elements_looked: rows.length,
    elements_ranked: converted.length,
    never_clicked_count: eligible.filter((r) => r.ratio == null).length,
    median_ratio: medianRatio,
    median_ratio_text: converted.length > 0 ? ratioText(medianRatio) : "—",
    friction_count: converted.filter((r) => r.band === "friction").length,
    converting_count: converted.filter((r) => r.band === "converting").length,
    top_elements: ranked.slice(0, TOP_ELEMENTS),
    looked_not_clicked: lookedNotClicked,
  };
}

// Takes the lean project doc and page subdoc, like every sibling.
export async function computeAttentionToAction(project, page) {
  const totalSessions = await Session.countDocuments({
    project_id: project._id,
    status: "completed",
    "pages_visited.template": page.path,
  });

  if (totalSessions === 0) return emptyResult(0);

  const pageFilter = pageMatchFilter(page);
  const elementKey = { $ifNull: ["$element_key", "$element_id"] };

  const [fixationGroups, clickGroups] = await Promise.all([
    Fixation.aggregate([
      { $match: { project_id: project._id, ...pageFilter, duration_ms: { $gte: MIN_FIXATION_MS } } },
      {
        $group: {
          _id: elementKey,
          sessions: { $addToSet: "$session_id" },
          fixation_count: { $sum: 1 },
          // Carried so a row can still show a component name: the region a
          // key's fixations were attributed to, plus the DOM fallbacks.
          region_id: { $first: "$region_id" },
          element_id: { $first: "$element_id" },
          element_tag: { $first: "$element_tag" },
          element_text: { $first: "$element_text" },
          element_alt: { $first: "$element_alt" },
          element_aria: { $first: "$element_aria" },
          element_src: { $first: "$element_src" },
        },
      },
    ]),
    Event.aggregate([
      { $match: { "metadata.project_id": project._id, ...pageFilter, type: "click" } },
      {
        $group: {
          _id: { $ifNull: ["$data.element_key", "$data.element_id"] },
          sessions: { $addToSet: "$session_id" },
          click_count: { $sum: 1 },
        },
      },
    ]),
  ]);

  return computeAttentionToActionStats({
    fixationGroups,
    clickGroups,
    regions: page.regions ?? [],
    totalSessions,
  });
}

export { MIN_FIXATION_MS, A2A_FRICTION, A2A_CONVERTING, MIN_SESSIONS_FOR_TOP, LBNC_THRESHOLD_PCT };
