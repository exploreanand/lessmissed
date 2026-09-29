import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-S03: Scroll-Back Events — occasions where a user, having scrolled to
// some depth, deliberately scrolls back UP. Attributed to the decile they
// landed on (the destination), because that's the region the user came back
// to re-check: "pricing section triggers scroll-backs in 28% of sessions". SRS §7.2.
//
// A scroll-back is a continuous upward motion of at least MIN_SCROLLBACK_PCT of
// the document. Sub-threshold wiggles are dropped: users constantly nudge the
// scroll wheel a few pixels and none of those are the "let me go look at that
// again" behavior the insight is trying to capture. One recorded event per
// upward run — a 30% pullback isn't ten small scroll-backs.

const DECILE_COUNT = 10;

// A pullback shorter than this is noise (touchpad wiggle, browser bounce on
// overscroll). Chosen to be a bit larger than the browser's own "smooth scroll"
// step so no purely mechanical bounce clears it.
const MIN_SCROLLBACK_PCT = 5;

// Same time-gap window as INS-S02 uses. Below the floor is the wheel driver
// double-firing; above the ceiling is a tab-away pause where the next event
// isn't part of the same motion as the previous one, and treating it as such
// would fabricate a scroll-back across the gap.
const MIN_TIME_DELTA_MS = 100;
const MAX_TIME_DELTA_MS = 30_000;

function emptyDeciles() {
  return Array.from({ length: DECILE_COUNT }, (_, i) => ({
    index: i,
    label: `${i * 10}-${(i + 1) * 10}%`,
    event_count: 0,
    session_count: 0,
    pct_sessions: 0,
  }));
}

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    sessions_with_scroll_back: 0,
    pct_sessions_with_scroll_back: 0,
    total_events: 0,
    deciles: emptyDeciles(),
    top_decile: null,
  };
}

// Takes lean project doc and page subdoc. Uses a lean find + JS walk over an
// aggregation because the transition-tracking (upward run detection) doesn't
// map cleanly to a $group pipeline.
export async function computeScrollBack(project, page) {
  // Same scoping rule as every other page-level insight.
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

  const events = await Event.find({
    "metadata.project_id": project._id,
    ...pageMatchFilter(page),
    type: "scroll",
  })
    .sort({ session_id: 1, timestamp: 1 })
    .select("session_id timestamp data.depth_pct")
    .lean();

  if (events.length === 0) return emptyResult(totalSessions);

  const deciles = emptyDeciles();
  // sessions_touched per decile — Set-of-session-ids so pct_sessions is
  // distinct-session-based, not per-event.
  const decileSessions = Array.from({ length: DECILE_COUNT }, () => new Set());
  const sessionsWithScrollBack = new Set();
  let totalEvents = 0;

  // Per-session state. Reset on every session change.
  let currentSession = null;
  let prevDepth = null;
  let prevTimestampMs = null;
  let inUpwardRun = false;
  let upwardRunStart = 0; // depth where the current upward motion began
  let upwardRunLow = 0; // lowest depth reached during this run (the destination)

  const finalizeRun = (sessionId) => {
    if (!inUpwardRun) return;
    const distance = upwardRunStart - upwardRunLow;
    if (distance >= MIN_SCROLLBACK_PCT) {
      const decileIdx = Math.min(
        DECILE_COUNT - 1,
        Math.max(0, Math.floor(upwardRunLow / 10))
      );
      deciles[decileIdx].event_count += 1;
      decileSessions[decileIdx].add(sessionId);
      sessionsWithScrollBack.add(sessionId);
      totalEvents += 1;
    }
    inUpwardRun = false;
    upwardRunStart = 0;
    upwardRunLow = 0;
  };

  for (const e of events) {
    const depth = e.data?.depth_pct;
    if (depth == null) continue;
    const tsMs = new Date(e.timestamp).getTime();

    if (e.session_id !== currentSession) {
      // A run left dangling at the end of the previous session still counts —
      // the user may have simply stopped scrolling after coming back up.
      if (currentSession != null) finalizeRun(currentSession);
      currentSession = e.session_id;
      prevDepth = null;
      prevTimestampMs = null;
      inUpwardRun = false;
      upwardRunStart = 0;
      upwardRunLow = 0;
    }

    if (prevDepth != null && prevTimestampMs != null) {
      const timeDelta = tsMs - prevTimestampMs;
      // Same window as S02. On a pause we finalize any run-in-progress and
      // then treat the next event as the start of a fresh motion — otherwise
      // a scroll-down at t=0 and a scroll-up at t=60s would fabricate a run.
      const inWindow =
        timeDelta >= MIN_TIME_DELTA_MS && timeDelta <= MAX_TIME_DELTA_MS;

      if (!inWindow) {
        finalizeRun(currentSession);
      } else if (depth < prevDepth) {
        // Upward motion.
        if (!inUpwardRun) {
          inUpwardRun = true;
          upwardRunStart = prevDepth;
          upwardRunLow = depth;
        } else if (depth < upwardRunLow) {
          upwardRunLow = depth;
        }
      } else if (depth > prevDepth) {
        // Downward motion — closes any run in progress.
        finalizeRun(currentSession);
      }
      // Equal depths are ignored: no motion, no state change.
    }

    prevDepth = depth;
    prevTimestampMs = tsMs;
  }

  // Close a run left dangling at the very last event of the last session.
  if (currentSession != null) finalizeRun(currentSession);

  deciles.forEach((d, i) => {
    d.session_count = decileSessions[i].size;
    d.pct_sessions = Math.round((d.session_count / totalSessions) * 100);
  });

  const topDecile =
    totalEvents > 0
      ? [...deciles].sort((a, b) => b.event_count - a.event_count)[0]
      : null;

  return {
    total_sessions: totalSessions,
    sessions_with_scroll_back: sessionsWithScrollBack.size,
    pct_sessions_with_scroll_back: Math.round(
      (sessionsWithScrollBack.size / totalSessions) * 100
    ),
    total_events: totalEvents,
    deciles,
    top_decile: topDecile,
  };
}
