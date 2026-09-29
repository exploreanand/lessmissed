import Fixation from "@/lib/models/Fixation";
import Session from "@/lib/models/Session";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-G07: Backtracking / Re-reading — instances where a user's gaze returns to
// a previously fixated element after having moved to a different one. High
// backtracking rates signal confusion (rechecking to make sense of a label) or
// comparison behavior (weighing two options). SRS §7.1.
//
// A revisit is defined per element key: fixation on A → at least one fixation
// on a DIFFERENT element → fixation on A again. Consecutive fixations on the
// same element (dwell) do not count as separate visits — same collapse rule
// INS-G06 uses to build reading-order steps.

// Same fixation-duration cutoff as G04/G05/G06/G08 — anything shorter is a
// saccade tail, not a real look.
const MIN_FIXATION_MS = 200;

// A session with fewer than this many fixations cannot meaningfully backtrack —
// you need enough looks for a repeated one to be a repeat rather than the
// whole session.
const MIN_FIXATIONS_PER_SESSION = 3;

// Elements only surface in the top list once at least this many sessions
// revisited them. Below this a "top" spot is a one-off and reads as noise.
const MIN_SESSIONS_FOR_TOP = 2;

// How many elements to return.
const TOP_ELEMENTS = 5;

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
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
}

function emptyResult(totalSessions) {
  return {
    total_sessions: totalSessions,
    sessions_with_backtracking: 0,
    pct_sessions_with_backtracking: 0,
    median_revisits_per_session: 0,
    avg_revisits_per_session: 0,
    top_revisited: [],
  };
}

// Takes the lean project doc and the page subdoc — not ids. Fixation.aggregate
// does not schema-cast $match, so project._id must already be an ObjectId; the
// page subdoc carries the region labels needed for the identity ladder.
export async function computeBacktracking(project, page) {
  // Same scoping rule as G04/G06/G08: sessions that actually reached this page.
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { session_id: 1 }
  ).lean();

  const totalSessions = sessions.length;
  if (totalSessions === 0) return emptyResult(0);

  const fixations = await Fixation.find({
    project_id: project._id,
    ...pageMatchFilter(page),
    duration_ms: { $gte: MIN_FIXATION_MS },
  })
    .sort({ session_id: 1, start_timestamp: 1 })
    .select(
      "session_id region_id element_id element_key element_tag element_text element_alt element_aria element_src"
    )
    .lean();

  if (fixations.length === 0) return emptyResult(totalSessions);

  const regionById = new Map((page.regions ?? []).map((r) => [r.region_id, r]));

  // Identity ladder: region → positional key → selector. Same order page.jsx
  // uses in its element aggregation. Without the middle rung every unclassed
  // <p> merges into one bucket and every session looks like it revisited "p".
  const keyFor = (f) => f.region_id || f.element_key || f.element_id || null;

  const labelFor = (f) => {
    const region = regionById.get(f.region_id);
    if (region?.label) return region.label;
    return describeElement(f).label;
  };

  // Per-session revisit accounting. `sessionVisits` counts distinct visits to
  // each element within one session; `sessionRevisitTotal` is that session's
  // total number of *repeat* visits (visits after the first) across elements.
  const sessionRevisitTotal = new Map(); // session_id -> number
  const sessionFixationCount = new Map(); // session_id -> number, for MIN_FIXATIONS filter

  // Per-element aggregation across sessions.
  const perElement = new Map(); // key -> { key, element_id, label, sessions_with_revisit:Set, total_revisits }

  let currentSession = null;
  let visitsInSession; // Map<key, visitCount>
  let prevKey = null;

  for (const f of fixations) {
    // Overlay instrumentation must not count as reading — the gaze dot isn't
    // content. Region-labelled fixations bypass the check (regions are never
    // overlays).
    if (!regionById.has(f.region_id) && isInstrumentElement(f.element_id)) continue;

    const key = keyFor(f);
    if (!key) continue;

    if (f.session_id !== currentSession) {
      currentSession = f.session_id;
      visitsInSession = new Map();
      prevKey = null;
    }

    sessionFixationCount.set(f.session_id, (sessionFixationCount.get(f.session_id) ?? 0) + 1);

    // Dwell — same element as the previous fixation. One visit, not two.
    if (key === prevKey) continue;

    const priorVisits = visitsInSession.get(key) ?? 0;
    visitsInSession.set(key, priorVisits + 1);
    prevKey = key;

    if (priorVisits >= 1) {
      // This is a return to `key` — element was visited before in this
      // session and we've since moved elsewhere.
      let stats = perElement.get(key);
      if (!stats) {
        stats = {
          key,
          element_id: f.element_id ?? key,
          label: labelFor(f),
          sessions_with_revisit: new Set(),
          total_revisits: 0,
        };
        perElement.set(key, stats);
      }
      stats.sessions_with_revisit.add(f.session_id);
      stats.total_revisits += 1;

      sessionRevisitTotal.set(
        f.session_id,
        (sessionRevisitTotal.get(f.session_id) ?? 0) + 1
      );
    }
  }

  // Only sessions with enough fixations count toward the "any backtracking"
  // rate — a two-fixation session that never returned to A hasn't declined to
  // backtrack, it never had the chance to.
  const eligibleSessions = [...sessionFixationCount.entries()].filter(
    ([, count]) => count >= MIN_FIXATIONS_PER_SESSION
  );
  const eligibleTotal = eligibleSessions.length;

  const sessionsWithBacktracking = eligibleSessions.filter(
    ([sid]) => (sessionRevisitTotal.get(sid) ?? 0) > 0
  ).length;

  // Median/avg computed only over sessions that had ≥1 revisit — otherwise the
  // headline reads as "median 0 revisits" on any page with a long tail of
  // brief sessions, which drowns the actual reading behavior.
  const revisitDist = eligibleSessions
    .map(([sid]) => sessionRevisitTotal.get(sid) ?? 0)
    .filter((n) => n > 0);

  const denominator = eligibleTotal || totalSessions;

  const topRevisited = [...perElement.values()]
    .map((e) => ({
      key: e.key,
      element_id: e.element_id,
      label: e.label,
      sessions_with_revisit: e.sessions_with_revisit.size,
      total_revisits: e.total_revisits,
      pct_sessions: Math.round((e.sessions_with_revisit.size / denominator) * 100),
      avg_revisits_when_revisited: Math.round(
        e.total_revisits / e.sessions_with_revisit.size
      ),
    }))
    .filter((e) => e.sessions_with_revisit >= MIN_SESSIONS_FOR_TOP)
    .sort((a, b) => {
      if (b.sessions_with_revisit !== a.sessions_with_revisit)
        return b.sessions_with_revisit - a.sessions_with_revisit;
      return b.total_revisits - a.total_revisits;
    })
    .slice(0, TOP_ELEMENTS);

  return {
    total_sessions: totalSessions,
    eligible_sessions: eligibleTotal,
    sessions_with_backtracking: sessionsWithBacktracking,
    pct_sessions_with_backtracking: eligibleTotal
      ? Math.round((sessionsWithBacktracking / eligibleTotal) * 100)
      : 0,
    median_revisits_per_session: median(revisitDist),
    avg_revisits_per_session: avg(revisitDist),
    top_revisited: topRevisited,
  };
}
