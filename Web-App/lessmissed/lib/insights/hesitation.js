import Event from "../models/Event.js";
import Fixation from "../models/Fixation.js";
import Session from "../models/Session.js";
import { describeElement, isInstrumentElement } from "./describeElement.js";
import { pageMatchFilter } from "../pathTemplate.js";

// INS-GC03: Hesitation Time — how long a session looked at an element before
// clicking it. SRS §7.4: "Time between first fixation and click on same
// element. Short = confident. Long = friction." One of the six combined-signal
// insights the SRS marks UNIQUE TO LESSMISSED.
//
// This is the exact complement of INS-GC02. computeClickedWithoutLooking builds
// the same per-session first-fixation index and then throws away every click
// that HAD a prior fixation ("if (hadPriorFixation) continue"). Those discarded
// clicks are this insight: the ones worth timing. Between them the two
// partition every non-instrument click on the page, which hesitation.test.mjs
// asserts directly — if either one's pairing rule drifts, that test fails.
//
// Relative imports, no "@/" alias, so tests and scripts can load it — the same
// reason pageMetrics.js gives.

// A fixation shorter than this is a saccade tail, not a look, so it cannot be
// the moment the user first saw the element. Same cut as G04/G05/G06/G07/G08
// and GC02.
const MIN_FIXATION_MS = 200;

// Above this, "hesitation" is the wrong word: the user saw the element, went
// away, read the rest of the page, and came back. Those pairs are counted and
// reported as pairs_over_cap, never folded into the median — an average that
// quietly absorbs a four-minute gap is not measuring hesitation. 30s is the
// clusterer's own MAX_FIXATION_MS (lib/fixationWindows.js).
const MAX_HESITATION_MS = 30000;

// Band edges — NOT from the spec. The SRS fixes the definition ("short =
// confident, long = friction") and gives no numbers, so these are a proposal,
// kept as named constants so they can be argued with rather than hunted for.
const CONFIDENT_MS = 1000;
const FRICTION_MS = 3000;

// An element enters the ranked list only when this many distinct sessions
// produced a measurable pair on it. One user's pause is an anecdote, not a
// page-level signal. Same floor as C02/C03/C04/GC02.
const MIN_SESSIONS_FOR_TOP = 2;

const TOP_ELEMENTS = 5;

const BAND_DEFS = [
  { band: "confident", label: "Confident", min_ms: 0, max_ms: CONFIDENT_MS },
  { band: "considered", label: "Considered", min_ms: CONFIDENT_MS, max_ms: FRICTION_MS },
  { band: "friction", label: "Friction", min_ms: FRICTION_MS, max_ms: null },
];

// Identical to the helper in scrollDepth/firstFixation/backtracking/scanPath,
// kept the same so medians stay comparable across cards.
function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// Nearest-rank percentile, so the result is always an observed value rather
// than an interpolation between two pairs that never happened.
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function bandFor(ms) {
  if (ms < CONFIDENT_MS) return "confident";
  if (ms < FRICTION_MS) return "considered";
  return "friction";
}

function emptyResult(totalSessions = 0, totalClicks = 0) {
  return {
    total_sessions: totalSessions,
    total_clicks: totalClicks,
    pairs_measured: 0,
    pairs_over_cap: 0,
    sessions_measured: 0,
    median_hesitation_ms: 0,
    avg_hesitation_ms: 0,
    p90_hesitation_ms: 0,
    bands: BAND_DEFS.map((b) => ({ ...b, pair_count: 0, pct: 0 })),
    top_elements: [],
    slowest_element: null,
    fastest_element: null,
  };
}

// Pure: no database, no clock. `fixations` are Fixation docs (session_id,
// start_timestamp, element_id/element_key, duration_ms) and `clicks` are click
// Events (session_id, timestamp, data.*) — the same shapes GC02 loads, so one
// fixture can drive both.
export function computeHesitationStats({ fixations = [], clicks = [], totalSessions = 0 } = {}) {
  const totalClicks = clicks.length;
  if (fixations.length === 0 || clicks.length === 0) {
    return emptyResult(totalSessions, totalClicks);
  }

  // Per-session earliest qualifying fixation per element key. Taking the
  // minimum rather than trusting arrival order keeps this correct for unsorted
  // input; the DB wrapper sorts anyway.
  const firstFixBySession = new Map();
  for (const f of fixations) {
    if (f.duration_ms != null && f.duration_ms < MIN_FIXATION_MS) continue;
    const key = f.element_key || f.element_id;
    if (!key) continue;
    const ts = new Date(f.start_timestamp).getTime();
    if (!Number.isFinite(ts)) continue;

    let m = firstFixBySession.get(f.session_id);
    if (!m) {
      m = new Map();
      firstFixBySession.set(f.session_id, m);
    }
    const prev = m.get(key);
    if (prev == null || ts < prev) m.set(key, ts);
  }

  // One pair per (session, element): the first click that followed the first
  // look. A later click on the same element is the same decision, already made,
  // and counting it again would weight talkative sessions more heavily.
  const pairs = new Map();
  for (const c of clicks) {
    const data = c.data ?? {};
    // Our own gaze-dot overlay is instrumentation, not the site.
    if (isInstrumentElement(data.element_id)) continue;
    const key = data.element_key || data.element_id;
    if (!key) continue;
    const clickTs = new Date(c.timestamp).getTime();
    if (!Number.isFinite(clickTs)) continue;

    // No prior look at all, or the only look came after the click. Both are
    // GC02's territory: there is no hesitation to time before a decision the
    // user had already made.
    const fixTs = firstFixBySession.get(c.session_id)?.get(key);
    if (fixTs == null || fixTs >= clickTs) continue;

    const hesitation_ms = clickTs - fixTs;
    const id = `${c.session_id}\u0000${key}`;
    const prev = pairs.get(id);
    if (prev && prev.hesitation_ms <= hesitation_ms) continue;
    pairs.set(id, { session_id: c.session_id, key, hesitation_ms, data });
  }

  const allPairs = [...pairs.values()];
  const measured = allPairs.filter((p) => p.hesitation_ms <= MAX_HESITATION_MS);
  const pairsOverCap = allPairs.length - measured.length;

  if (measured.length === 0) {
    // Every pair was a look-then-leave-then-return. Say so rather than
    // reporting a median of nothing.
    return { ...emptyResult(totalSessions, totalClicks), pairs_over_cap: pairsOverCap };
  }

  const durations = measured.map((p) => p.hesitation_ms);

  const bands = BAND_DEFS.map((b) => {
    const pair_count = measured.filter((p) => bandFor(p.hesitation_ms) === b.band).length;
    return {
      ...b,
      pair_count,
      pct: Math.round((pair_count / measured.length) * 100),
    };
  });

  const perElement = new Map();
  for (const p of measured) {
    let stats = perElement.get(p.key);
    if (!stats) {
      stats = {
        key: p.key,
        element_id: p.data.element_id ?? p.key,
        label: describeElement(p.data).label,
        element_tag: p.data.element_tag ?? null,
        is_interactive: p.data.is_interactive ?? null,
        sessions: new Set(),
        hesitations: [],
      };
      perElement.set(p.key, stats);
    }
    stats.sessions.add(p.session_id);
    stats.hesitations.push(p.hesitation_ms);
  }

  // Ranked slowest first — the friction end is the actionable one. Only
  // elements over the session floor are ranked, so neither the list nor the
  // slowest/fastest headline can be driven by a single user.
  const ranked = [...perElement.values()]
    .filter((s) => s.sessions.size >= MIN_SESSIONS_FOR_TOP)
    .map((s) => ({
      key: s.key,
      element_id: s.element_id,
      label: s.label,
      element_tag: s.element_tag,
      is_interactive: s.is_interactive,
      sessions_measured: s.sessions.size,
      pair_count: s.hesitations.length,
      median_hesitation_ms: median(s.hesitations),
      band: bandFor(median(s.hesitations)),
    }))
    .sort((a, b) => {
      if (b.median_hesitation_ms !== a.median_hesitation_ms)
        return b.median_hesitation_ms - a.median_hesitation_ms;
      return b.sessions_measured - a.sessions_measured;
    });

  return {
    total_sessions: totalSessions,
    total_clicks: totalClicks,
    pairs_measured: measured.length,
    pairs_over_cap: pairsOverCap,
    sessions_measured: new Set(measured.map((p) => p.session_id)).size,
    median_hesitation_ms: median(durations),
    avg_hesitation_ms: avg(durations),
    p90_hesitation_ms: percentile(durations, 90),
    bands,
    top_elements: ranked.slice(0, TOP_ELEMENTS),
    slowest_element: ranked[0] ?? null,
    fastest_element: ranked.length > 1 ? ranked[ranked.length - 1] : null,
  };
}

// Takes the lean project doc and page subdoc, like every sibling. Two selective
// finds and a JS join — the same pair GC02 issues, since the inputs are
// identical.
export async function computeHesitationTime(project, page) {
  const totalSessions = await Session.countDocuments({
    project_id: project._id,
    status: "completed",
    "pages_visited.template": page.path,
  });

  if (totalSessions === 0) return emptyResult(0, 0);

  const [clicks, fixations] = await Promise.all([
    Event.find({
      "metadata.project_id": project._id,
      ...pageMatchFilter(page),
      type: "click",
    })
      .sort({ session_id: 1, timestamp: 1 })
      .select(
        "session_id timestamp data.element_id data.element_key data.element_tag data.element_text data.element_alt data.element_aria data.element_src data.is_interactive"
      )
      .lean(),
    Fixation.find({
      project_id: project._id,
      ...pageMatchFilter(page),
      duration_ms: { $gte: MIN_FIXATION_MS },
    })
      .sort({ session_id: 1, start_timestamp: 1 })
      .select("session_id start_timestamp element_id element_key duration_ms")
      .lean(),
  ]);

  return computeHesitationStats({ fixations, clicks, totalSessions });
}

export {
  MIN_FIXATION_MS,
  MAX_HESITATION_MS,
  CONFIDENT_MS,
  FRICTION_MS,
  MIN_SESSIONS_FOR_TOP,
  BAND_DEFS,
};
