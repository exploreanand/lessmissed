import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { pageMatchFilter } from "@/lib/pathTemplate";

// INS-S02: Scroll Velocity Map — per-decile average rate at which sessions
// moved through the page. Fast passes read as skimming; slow passes read as
// reading carefully. Complements INS-S01 ("how far did they get") and the
// existing time-at-depth attention scroll heatmap ("how long did they linger")
// by capturing the derivative in between. SRS §7.2.
//
// The signal is the |Δdepth_pct| between consecutive scroll events, divided by
// the time gap between them. Attributed to the decile the user was IN when the
// motion started, which is what the user's attention was on as they moved.

const DECILE_COUNT = 10;

// Sub-100ms gaps between scroll events are usually the wheel driver firing
// twice in one frame; the depth barely changes and the velocity gets absurd.
// A 30s+ gap almost always means the user paused (tab-away, dwell) and the
// next scroll is unrelated to the last one — attributing it to the start
// decile would smear one motion's velocity across a pause it didn't span.
const MIN_TIME_DELTA_MS = 100;
const MAX_TIME_DELTA_MS = 30_000;

// Category thresholds. Chosen so the intuition matches the SRS phrasing:
//   ≥ 50 %/s ≈ the user covered more than half the document per second (a
//   flick of the wheel — clearly not reading);
//   ≤ 5 %/s ≈ 20+ seconds spent per 10% of the page (dwell that reads as
//   attention, roughly one paragraph per screenful).
const SKIM_THRESHOLD_PCT_PER_S = 50;
const READ_THRESHOLD_PCT_PER_S = 5;

function emptyDeciles() {
  return Array.from({ length: DECILE_COUNT }, (_, i) => ({
    index: i,
    label: `${i * 10}-${(i + 1) * 10}%`,
    velocity_pct_per_s: 0,
    sample_count: 0,
    session_count: 0,
    pct_sessions: 0,
    category: null,
  }));
}

function emptyResult(totalSessions = 0) {
  return {
    total_sessions: totalSessions,
    deciles: emptyDeciles(),
    fastest_decile: null,
    slowest_decile: null,
    total_samples: 0,
  };
}

function classify(velocity, hasData) {
  if (!hasData) return null;
  if (velocity >= SKIM_THRESHOLD_PCT_PER_S) return "skimmed";
  if (velocity <= READ_THRESHOLD_PCT_PER_S) return "read";
  return "browsed";
}

// Takes lean project doc and page subdoc. Event.aggregate isn't used — the
// pairwise-diff logic doesn't map cleanly to $group, and the find query is
// selective enough (single page, scroll only) that a lean cursor is cheaper
// than a full pipeline.
export async function computeScrollVelocity(project, page) {
  // Same scoping rule as every other page-level insight. Rejected sessions
  // and sessions that never reached this page would only add noise here.
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

  // Per-decile accumulators. Time-weighted average is the honest read — an
  // arithmetic mean of per-pair velocities would treat a 5-second slow pass
  // and a 0.1-second twitch as equal samples, and the twitch would dominate.
  const buckets = Array.from({ length: DECILE_COUNT }, () => ({
    total_delta_pct: 0,
    total_time_ms: 0,
    sample_count: 0,
    sessions: new Set(),
  }));

  let currentSession = null;
  let prevDepth = null;
  let prevTimestampMs = null;

  for (const e of events) {
    const depth = e.data?.depth_pct;
    if (depth == null) continue;

    if (e.session_id !== currentSession) {
      currentSession = e.session_id;
      prevDepth = null;
      prevTimestampMs = null;
    }

    const tsMs = new Date(e.timestamp).getTime();
    if (prevDepth != null && prevTimestampMs != null) {
      const timeDelta = tsMs - prevTimestampMs;
      const depthDelta = Math.abs(depth - prevDepth);
      if (
        timeDelta >= MIN_TIME_DELTA_MS &&
        timeDelta <= MAX_TIME_DELTA_MS &&
        depthDelta > 0
      ) {
        // Start-decile attribution: what region were they in as this motion
        // began? The alternative (span across every crossed decile) is more
        // faithful for long jumps but also over-attributes short jumps that
        // happen to straddle a decile boundary — the tradeoff isn't worth
        // the complexity for a first cut.
        const decileIdx = Math.min(
          DECILE_COUNT - 1,
          Math.max(0, Math.floor(prevDepth / 10))
        );
        const bucket = buckets[decileIdx];
        bucket.total_delta_pct += depthDelta;
        bucket.total_time_ms += timeDelta;
        bucket.sample_count += 1;
        bucket.sessions.add(e.session_id);
      }
    }

    prevDepth = depth;
    prevTimestampMs = tsMs;
  }

  let totalSamples = 0;
  const deciles = buckets.map((b, i) => {
    totalSamples += b.sample_count;
    const hasData = b.total_time_ms > 0;
    const velocity = hasData ? b.total_delta_pct / (b.total_time_ms / 1000) : 0;
    return {
      index: i,
      label: `${i * 10}-${(i + 1) * 10}%`,
      velocity_pct_per_s: Math.round(velocity * 10) / 10,
      sample_count: b.sample_count,
      session_count: b.sessions.size,
      pct_sessions: Math.round((b.sessions.size / totalSessions) * 100),
      category: classify(velocity, hasData),
    };
  });

  if (totalSamples === 0) return emptyResult(totalSessions);

  const withData = deciles.filter((d) => d.sample_count > 0);
  const fastest = withData
    .slice()
    .sort((a, b) => b.velocity_pct_per_s - a.velocity_pct_per_s)[0];
  const slowest = withData
    .slice()
    .sort((a, b) => a.velocity_pct_per_s - b.velocity_pct_per_s)[0];

  return {
    total_sessions: totalSessions,
    deciles,
    fastest_decile: fastest ?? null,
    slowest_decile: slowest ?? null,
    total_samples: totalSamples,
  };
}
