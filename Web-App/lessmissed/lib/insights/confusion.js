import Event from "../models/Event.js";
import { ramp } from "./engagement.js";
import { loadGazeSequences } from "./gazeSequence.js";
import { buildHesitationPairs, CONFIDENT_MS, MAX_HESITATION_MS } from "./hesitation.js";
import { pageMatchFilter } from "../pathTemplate.js";

// INS-SL01: Confusion Score — SRS §7.5: "Composite: backtracking (30%) +
// scroll-backs (25%) + hesitation time (25%) + re-fixation ratio (20%)."
// [MEDIUM confidence], and the spec says so itself.
//
// The four weights are the spec's. Everything else here is a proposal, because
// the spec names the ingredients and not one boundary: it does not say how much
// backtracking is a lot, or how long a pause is a long one. Every ramp below is
// therefore a named constant with its reasoning, in the style of
// pageMetrics.js's HEALTH_WEIGHTS ("NOT from the spec").
//
// Scored per session, which is what §7.5 and Session.summary.confusion_score
// both imply, then aggregated for the page card.
//
// `Session.summary.confusion_score` is deliberately NOT written. That field has
// a reader (the orphaned pages/[pageSlug]/insights route) and has never had a
// writer, so it reads 0 for every session ever recorded. Reviving a cached
// field with no writer is the exact mistake pageMetrics.js:1-13 exists to
// undo — this computes on read instead, from source data, every time.
//
// Backtracking and re-fixation ratio are close cousins, which is presumably why
// the spec weights them separately: the first is the raw amount of going back,
// the second is how much of the session was spent doing it. A long session with
// ten revisits and a short one with ten revisits are not equally confused.
//
// Relative imports, no "@/" alias, so tests and scripts can load it.

const WEIGHTS = { backtracking: 30, scroll_backs: 25, hesitation: 25, refixation: 20 };

// Below this many visits there is no reading pattern to read. Such sessions are
// left unscored rather than scored 0 — "we could not tell" is not "calm".
const MIN_VISITS_FOR_SCORE = 3;

// Ramp boundaries: the value that scores 0, and the value that scores 100.
// All proposals.
//
// One revisit is ordinary re-reading, so that is the zero mark; ten is someone
// going round in circles.
const BACKTRACK_ZERO = 1;
const BACKTRACK_FULL = 10;

// Scroll-backs are rarer and more deliberate than a glance back, so the scale
// is tighter: none is calm, four separate trips back up is lost.
const SCROLLBACK_ZERO = 0;
const SCROLLBACK_FULL = 4;

// Hesitation shares its zero mark with GC03's "confident" band, so the two
// cards cannot disagree about what a quick decision is. Five seconds of staring
// before a click is the top of the scale.
const HESITATION_FULL_MS = 5_000;

// A tenth of visits being returns is normal reading; half is thrashing.
const REFIXATION_ZERO = 0.1;
const REFIXATION_FULL = 0.5;

const BAND_DEFS = [
  { band: "calm", label: "Calm", min: 0, max: 33 },
  { band: "unsettled", label: "Unsettled", min: 34, max: 66 },
  { band: "confused", label: "Confused", min: 67, max: 100 },
];

const WORST_SESSIONS = 5;

// Mirrors INS-S03's rule in scrollBack.js, which cannot be imported here
// because it resolves its models through the "@/" alias. Same thresholds, so
// the two cards count the same events: a scroll-back is one continuous upward
// run of at least MIN_SCROLLBACK_PCT of the document, and a pause outside the
// time window ends the run rather than bridging it.
const MIN_SCROLLBACK_PCT = 5;
const MIN_TIME_DELTA_MS = 100;
const MAX_TIME_DELTA_MS = 30_000;

// One key contains the other: the same thing seen at two DOM depths.
function isNested(x, y) {
  return String(x).startsWith(y + ">") || String(y).startsWith(x + ">");
}

// Gaze resolution flickers between a block and its own child, and a "return"
// from a child back up to its parent never actually left. Merging those runs is
// the same correction GC06 makes at the pair level, and it is not cosmetic:
// measured 2026-11-20, it removed 58% of the revisits on the landing page and
// 74% on /products. Backtracking and re-fixation carry half this score's weight
// between them, so without it most of the "confusion" on a page is the eye
// tracker's own imprecision.
function collapseNested(visits) {
  const settled = [];
  for (const v of visits) {
    const last = settled[settled.length - 1];
    if (last && (last.key === v.key || isNested(last.key, v.key))) continue;
    settled.push(v);
  }
  return settled;
}

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

function bandFor(score) {
  return BAND_DEFS.find((b) => score >= b.min && score <= b.max)?.band ?? "calm";
}

// Pure. Returns Map<session_id, count>. A session appears with 0 once any
// scroll event of its own was seen, so a later zero means "they did not scroll
// back" rather than "we never watched them scroll".
export function countScrollBacksBySession({ scrollEvents = [] } = {}) {
  const ordered = [...scrollEvents]
    .map((e) => ({ e, ts: new Date(e.timestamp).getTime() }))
    .filter((x) => Number.isFinite(x.ts) && x.e.data?.depth_pct != null)
    .sort((a, b) =>
      a.e.session_id === b.e.session_id
        ? a.ts - b.ts
        : a.e.session_id < b.e.session_id
        ? -1
        : 1
    );

  const counts = new Map();
  let currentSession = null;
  let prevDepth = null;
  let prevTs = null;
  let inRun = false;
  let runStart = 0;
  let runLow = 0;

  const finalize = (sid) => {
    if (!inRun) return;
    if (runStart - runLow >= MIN_SCROLLBACK_PCT) counts.set(sid, (counts.get(sid) ?? 0) + 1);
    inRun = false;
    runStart = 0;
    runLow = 0;
  };

  for (const { e, ts } of ordered) {
    const depth = e.data.depth_pct;

    if (e.session_id !== currentSession) {
      // A run left dangling at the end of a session still counts — they may
      // simply have stopped scrolling after coming back up.
      if (currentSession != null) finalize(currentSession);
      currentSession = e.session_id;
      prevDepth = null;
      prevTs = null;
      inRun = false;
    }
    if (!counts.has(e.session_id)) counts.set(e.session_id, 0);

    if (prevDepth != null && prevTs != null) {
      const dt = ts - prevTs;
      const inWindow = dt >= MIN_TIME_DELTA_MS && dt <= MAX_TIME_DELTA_MS;
      if (!inWindow) {
        finalize(currentSession);
      } else if (depth < prevDepth) {
        if (!inRun) {
          inRun = true;
          runStart = prevDepth;
          runLow = depth;
        } else if (depth < runLow) {
          runLow = depth;
        }
      } else if (depth > prevDepth) {
        finalize(currentSession);
      }
      // Equal depths are no motion and change nothing.
    }

    prevDepth = depth;
    prevTs = ts;
  }
  if (currentSession != null) finalize(currentSession);

  return counts;
}

// Pure. One session's score, or null when there is not enough of a session to
// judge. Components that could not be measured are dropped and the remaining
// weights renormalized, so a session that never clicked is not credited with a
// confident click.
export function scoreSessionConfusion({ visits = [], scrollBacks = null, hesitationMs = null } = {}) {
  // Judged on the settled path, and the floor applies to it too: a session
  // whose dozen visits collapse to two has no reading pattern to read.
  const settled = collapseNested(visits);
  if (settled.length < MIN_VISITS_FOR_SCORE) return null;

  const seen = new Set();
  let revisits = 0;
  for (const v of settled) {
    if (seen.has(v.key)) revisits += 1;
    else seen.add(v.key);
  }
  const refixationRatio = revisits / settled.length;

  const parts = [
    ["backtracking", ramp(revisits, BACKTRACK_ZERO, BACKTRACK_FULL)],
    ["refixation", ramp(refixationRatio, REFIXATION_ZERO, REFIXATION_FULL)],
  ];
  if (scrollBacks != null) {
    parts.push(["scroll_backs", ramp(scrollBacks, SCROLLBACK_ZERO, SCROLLBACK_FULL)]);
  }
  if (hesitationMs != null) {
    parts.push(["hesitation", ramp(hesitationMs, CONFIDENT_MS, HESITATION_FULL_MS)]);
  }

  const weightUsed = parts.reduce((a, [k]) => a + WEIGHTS[k], 0);
  const score = Math.round(
    parts.reduce((a, [k, v]) => a + WEIGHTS[k] * v, 0) / weightUsed
  );

  return {
    score,
    band: bandFor(score),
    components: Object.fromEntries(parts),
    weight_used: weightUsed,
    visits: settled.length,
    revisits,
    refixation_ratio: Math.round(refixationRatio * 100) / 100,
    scroll_backs: scrollBacks,
    hesitation_ms: hesitationMs,
  };
}

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    sessions_scored: 0,
    avg_score: 0,
    median_score: 0,
    bands: BAND_DEFS.map((b) => ({ ...b, session_count: 0, pct: 0 })),
    component_averages: {},
    component_coverage: {},
    worst_sessions: [],
    weights: WEIGHTS,
  };
}

// Pure.
export function computeConfusionStats({
  sequences = new Map(),
  hesitationPairs = [],
  scrollBacksBySession = new Map(),
  totalSessions = 0,
} = {}) {
  if (sequences.size === 0) return emptyResult(totalSessions);

  // Median hesitation per session, over pairs inside GC03's cap — a look, a
  // wander off and a click four minutes later is not a pause for thought.
  const hesitationBySession = new Map();
  for (const p of hesitationPairs) {
    if (p.hesitation_ms > MAX_HESITATION_MS) continue;
    let list = hesitationBySession.get(p.session_id);
    if (!list) {
      list = [];
      hesitationBySession.set(p.session_id, list);
    }
    list.push(p.hesitation_ms);
  }

  const scored = [];
  for (const [sessionId, visits] of sequences) {
    const hesitations = hesitationBySession.get(sessionId);
    const row = scoreSessionConfusion({
      visits,
      scrollBacks: scrollBacksBySession.has(sessionId)
        ? scrollBacksBySession.get(sessionId)
        : null,
      hesitationMs: hesitations?.length ? median(hesitations) : null,
    });
    if (row) scored.push({ session_id: sessionId, ...row });
  }

  if (scored.length === 0) return emptyResult(totalSessions);

  const scores = scored.map((s) => s.score);
  const bands = BAND_DEFS.map((b) => {
    const session_count = scored.filter((s) => s.band === b.band).length;
    return {
      ...b,
      session_count,
      pct: Math.round((session_count / scored.length) * 100),
    };
  });

  // Averaged over the sessions where each component was measurable, and the
  // count of those sessions beside it. Averaging a missing component as zero
  // would make every page look calmer the less data it had.
  const componentAverages = {};
  const componentCoverage = {};
  for (const key of Object.keys(WEIGHTS)) {
    const values = scored
      .map((s) => s.components[key])
      .filter((v) => Number.isFinite(v));
    componentAverages[key] = avg(values);
    componentCoverage[key] = values.length;
  }

  return {
    total_sessions: totalSessions,
    sessions_scored: scored.length,
    avg_score: avg(scores),
    median_score: median(scores),
    bands,
    component_averages: componentAverages,
    component_coverage: componentCoverage,
    worst_sessions: [...scored]
      .sort((a, b) => b.score - a.score)
      .slice(0, WORST_SESSIONS)
      .map((s) => ({
        session_id: s.session_id,
        score: s.score,
        band: s.band,
        revisits: s.revisits,
        refixation_ratio: s.refixation_ratio,
        scroll_backs: s.scroll_backs,
        hesitation_ms: s.hesitation_ms,
      })),
    weights: WEIGHTS,
  };
}

// Takes the lean project doc and page subdoc, like every sibling.
export async function computeConfusion(project, page) {
  const { totalSessions, sequences, fixations, clicks } = await loadGazeSequences(project, page);
  if (totalSessions === 0) return emptyResult(0);

  const scrollEvents = await Event.find({
    "metadata.project_id": project._id,
    ...pageMatchFilter(page),
    type: "scroll",
  })
    .sort({ session_id: 1, timestamp: 1 })
    .select("session_id timestamp data.depth_pct")
    .lean();

  return computeConfusionStats({
    sequences,
    hesitationPairs: buildHesitationPairs({ fixations, clicks }),
    scrollBacksBySession: countScrollBacksBySession({ scrollEvents }),
    totalSessions,
  });
}

export {
  collapseNested,
  WEIGHTS,
  MIN_VISITS_FOR_SCORE,
  BACKTRACK_FULL,
  SCROLLBACK_FULL,
  HESITATION_FULL_MS,
  REFIXATION_FULL,
  BAND_DEFS,
};
