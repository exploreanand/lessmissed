import { isNearKey, loadGazeSequences } from "./gazeSequence.js";

// INS-GC06: Comparison Behavior — SRS §7.4: "Gaze alternating A-B-A-B (2+
// times in 10s) before clicking one. 'Users compare plan-basic and plan-pro
// 3.2 times before choosing.'"
//
// Read off the shared gaze path from gazeSequence.js, where consecutive dwell
// on one element is already collapsed into a single visit — without that, a
// long steady look at one option would read as a string of repeat visits and
// every element would appear to be compared with itself.
//
// For a candidate pair, the sequence is restricted to just those two elements
// and scanned for the densest 10s window. The pattern counts when that window
// holds at least two visits to EACH side: that is what "A-B-A-B, 2+ times"
// describes, and it is the test that separates deliberate weighing-up from a
// glance that happened to pass back over something.
//
// Candidate pairs are only those that appear as consecutive visits at some
// point. Two elements a visitor looked at in unrelated parts of the session are
// not being compared, and restricting the candidates this way also keeps the
// pair scan off every O(n^2) combination of elements on the page.
//
// A pair where one element CONTAINS the other is thrown out. Gaze resolution
// flickers between a block and its own child, which produces a textbook
// A-B-A-B with nothing being compared — measured 2026-11-20, that accounted
// for 39% of adjacent pairs on the landing page and 63% on /products, and it
// is what produced top rows reading "Three Simple Steps…" versus "Three Simple
// Steps…". A node and its own child are one thing seen at two depths.
//
// What survives is still not necessarily two OPTIONS. `both_choosable` marks
// the pairs where each side has an interactive control at or inside it — the
// plan-basic-vs-plan-pro shape the spec describes — because on real data so far
// every detected comparison is between two blocks of copy, and the card must
// not report those as competing products. It is reported rather than filtered
// on: requiring it leaves zero comparisons on every page in the database.
//
// The click is matched with isNearKey, not by equality, for the reason GC05
// documents at length: gaze resolves to the container and a click to the
// control inside it, so requiring the same key would report that nobody ever
// chooses. A click anywhere inside a compared block counts as choosing it.
//
// Relative imports, no "@/" alias, so tests and scripts can load it.

// Each side of the pair must be visited this many times inside the window.
// Straight from the spec's "A-B-A-B (2+ times)".
const MIN_VISITS_EACH = 2;

// And within this long, also from the spec.
const WINDOW_MS = 10_000;

// A pair is named only when this many sessions compared it. One visitor
// glancing between two things is not a comparison the page induces.
const MIN_SESSIONS_FOR_TOP = 2;

const TOP_PAIRS = 5;

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    sessions_comparing: 0,
    pct_sessions_comparing: 0,
    choosable_pairs: 0,
    pairs_found: 0,
    total_comparisons: 0,
    comparisons_with_choice: 0,
    avg_alternations: 0,
    top_pairs: [],
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// The densest ≤10s stretch of back-and-forth between the two sides. Returns
// the number of switches in it, or 0 if no window qualifies.
function bestWindowAlternations(restricted) {
  let best = 0;
  for (let i = 0; i < restricted.length; i++) {
    let a = 0;
    let b = 0;
    let switches = 0;
    let prev = null;
    for (let j = i; j < restricted.length; j++) {
      if (restricted[j].start_ms - restricted[i].start_ms > WINDOW_MS) break;
      const isA = restricted[j].isA;
      if (isA) a += 1;
      else b += 1;
      if (prev !== null && isA !== prev) switches += 1;
      prev = isA;
      if (a >= MIN_VISITS_EACH && b >= MIN_VISITS_EACH && switches > best) best = switches;
    }
  }
  return best;
}

const pairId = (x, y) => (x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`);

// One key contains the other: the same thing seen at two DOM depths.
function isNested(x, y) {
  return String(x).startsWith(y + ">") || String(y).startsWith(x + ">");
}

// Does an interactive click target sit at or inside this element?
function isChoosable(key, targets) {
  if (!targets || targets.size === 0) return false;
  for (const t of targets.keys ? targets.keys() : targets) {
    if (key === t || String(t).startsWith(key + ">")) return true;
  }
  return false;
}

// Pure. `sequences` is Map<session_id, visit[]> from buildSessionVisits and
// `clicksBySession` is Map<session_id, Set<key>> from buildSessionClicks.
export function computeComparisonStats({
  sequences = new Map(),
  clicksBySession = new Map(),
  targets,
  totalSessions = 0,
} = {}) {
  if (sequences.size === 0) return emptyResult(totalSessions);

  const pairs = new Map();
  const sessionsComparing = new Set();
  let totalComparisons = 0;
  let comparisonsWithChoice = 0;
  const alternationSamples = [];

  for (const [sessionId, visits] of sequences) {
    if (visits.length < MIN_VISITS_EACH * 2) continue;

    // Pairs that were ever adjacent — the only plausible comparisons.
    const candidates = new Map();
    for (let i = 1; i < visits.length; i++) {
      const x = visits[i - 1].key;
      const y = visits[i].key;
      if (x === y) continue;
      if (isNested(x, y)) continue; // gaze jitter between a block and its child
      candidates.set(pairId(x, y), [x, y]);
    }

    const clicked = clicksBySession.get(sessionId) ?? new Set();
    const clickedNear = (key) => {
      for (const c of clicked) if (isNearKey(key, c)) return true;
      return false;
    };

    for (const [id, [x, y]] of candidates) {
      const restricted = [];
      for (const v of visits) {
        if (v.key === x) restricted.push({ isA: true, start_ms: v.start_ms });
        else if (v.key === y) restricted.push({ isA: false, start_ms: v.start_ms });
      }

      const alternations = bestWindowAlternations(restricted);
      if (alternations === 0) continue;

      const first = visits.find((v) => v.key === x);
      const second = visits.find((v) => v.key === y);

      let stats = pairs.get(id);
      if (!stats) {
        stats = {
          id,
          a: { key: x, label: first?.label ?? x, element_id: first?.element_id ?? x },
          b: { key: y, label: second?.label ?? y, element_id: second?.element_id ?? y },
          sessions: new Set(),
          alternations: [],
          clicked_a: 0,
          clicked_b: 0,
          clicked_neither: 0,
          both_choosable: isChoosable(x, targets) && isChoosable(y, targets),
        };
        pairs.set(id, stats);
      }

      stats.sessions.add(sessionId);
      stats.alternations.push(alternations);
      totalComparisons += 1;
      alternationSamples.push(alternations);
      sessionsComparing.add(sessionId);

      const tookA = clickedNear(x);
      const tookB = clickedNear(y);
      if (tookA) stats.clicked_a += 1;
      if (tookB) stats.clicked_b += 1;
      if (!tookA && !tookB) stats.clicked_neither += 1;
      else comparisonsWithChoice += 1;
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((p, q) => p + q, 0) / arr.length : 0);

  const topPairs = [...pairs.values()]
    .filter((p) => p.sessions.size >= MIN_SESSIONS_FOR_TOP)
    .sort((p, q) => {
      // Two genuine options outrank two blocks of copy, whatever the counts.
      if (q.both_choosable !== p.both_choosable) return q.both_choosable ? 1 : -1;
      if (q.sessions.size !== p.sessions.size) return q.sessions.size - p.sessions.size;
      return avg(q.alternations) - avg(p.alternations);
    })
    .slice(0, TOP_PAIRS)
    .map((p) => ({
      a: p.a,
      b: p.b,
      sessions: p.sessions.size,
      pct_sessions: totalSessions > 0 ? Math.round((p.sessions.size / totalSessions) * 100) : 0,
      avg_alternations: round1(avg(p.alternations)),
      max_alternations: Math.max(...p.alternations),
      clicked_a: p.clicked_a,
      clicked_b: p.clicked_b,
      clicked_neither: p.clicked_neither,
      both_choosable: p.both_choosable,
      // Which side the comparison tended to end on. Null when they tie, or
      // when nobody chose either — "they compared and walked away" is a
      // finding, not a missing value.
      winner:
        p.clicked_a > p.clicked_b ? "a" : p.clicked_b > p.clicked_a ? "b" : null,
    }));

  return {
    total_sessions: totalSessions,
    sessions_comparing: sessionsComparing.size,
    // Of the pairs found, how many were two things a visitor could actually
    // choose between. Zero means every comparison was between blocks of copy.
    choosable_pairs: [...pairs.values()].filter((p) => p.both_choosable).length,
    pairs_found: pairs.size,
    pct_sessions_comparing:
      totalSessions > 0 ? Math.round((sessionsComparing.size / totalSessions) * 100) : 0,
    total_comparisons: totalComparisons,
    comparisons_with_choice: comparisonsWithChoice,
    avg_alternations: round1(avg(alternationSamples)),
    top_pairs: topPairs,
  };
}

// Takes the lean project doc and page subdoc, like every sibling.
export async function computeComparison(project, page) {
  const { totalSessions, sequences, clicksBySession, targets } = await loadGazeSequences(
    project,
    page
  );
  if (totalSessions === 0) return emptyResult(0);
  return computeComparisonStats({ sequences, clicksBySession, targets, totalSessions });
}

export { MIN_VISITS_EACH, WINDOW_MS, MIN_SESSIONS_FOR_TOP };
