// The web service's own session sweep.
//
// Finalization used to live only in the capture worker's poll loop. That worker
// is a single Fargate Spot task with no load balancer, so whenever Spot
// reclaimed it — or the stack was paused, or nobody was running `npm start`
// locally — no session was ever finalized and no fixations were ever derived.
// The web service is always up, so it runs the sweep too.
//
// Both sweepers are safe to run at once: sweepIdleSessions claims each session
// with a lease before touching it, so the work goes to whichever process gets
// there first. The thresholds here are deliberately *longer* than the worker's,
// so the 2-vCPU worker wins every race while it is alive and this loop only
// picks up what a Spot interruption left behind. That matters because finalize
// is the heaviest thing either process does and this one also serves the tag.
import { connectDB } from "../mongoose.js";
import { sweepIdleSessions } from "./sweepIdleSessions.js";

const num = (name, fallback) => {
  const raw = process.env[name];
  const n = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

// A tick slower than this means the cluster or this task is struggling; sit the
// next one out rather than queueing finalizes behind each other.
const SLOW_TICK_MS = 5000;

let started = false;
let running = false;
let skipNext = false;

export function sweepLoopConfig() {
  return {
    intervalMs: num("WEB_SWEEP_INTERVAL_MS", 30_000),
    // Longer than the worker's 30 minutes, so the worker claims idle sessions
    // first and this is only ever the backstop.
    idleMs: num("WEB_SWEEP_IDLE_MS", 45 * 60 * 1000),
    // Likewise longer than the worker's 60s. SESSION_LEAVE_GRACE_MS is honoured
    // as a fallback so a single env var shortens both in development.
    leaveGraceMs: num("WEB_SWEEP_LEAVE_GRACE_MS", num("SESSION_LEAVE_GRACE_MS", 90_000)),
    // A "hidden" hint also fires on a plain tab switch, so it waits much
    // longer than a pagehide. It is the signal that still arrives when a
    // tab-close beacon is dropped, which is what keeps that case off the
    // 30-minute idle rule.
    hiddenGraceMs: num("WEB_SWEEP_HIDDEN_GRACE_MS", num("SESSION_HIDDEN_GRACE_MS", 6 * 60_000)),
    // Small: one finalize reads a whole session's gaze stream, and this process
    // is answering tag requests at the same time.
    limit: num("WEB_SWEEP_LIMIT", 3),
  };
}

/**
 * Start the sweep. Idempotent — Next can call register() more than once per
 * process, and in dev it does.
 */
export function startSessionSweepLoop(config = sweepLoopConfig()) {
  if (started) return null;
  started = true;

  const { intervalMs, idleMs, leaveGraceMs, hiddenGraceMs, limit } = config;
  console.log(
    `[sweep] session sweep every ${Math.round(intervalMs / 1000)}s ` +
      `(closed grace ${Math.round(leaveGraceMs / 1000)}s, hidden grace ${Math.round(hiddenGraceMs / 1000)}s, ` +
      `idle ${Math.round(idleMs / 60000)}m, limit ${limit})`
  );

  const tick = async () => {
    // Never let two ticks overlap, and back off after a slow one.
    if (running) return;
    if (skipNext) {
      skipNext = false;
      return;
    }
    running = true;
    const startedAt = Date.now();
    try {
      await connectDB();
      const { finalized, byLeave, byIdle } = await sweepIdleSessions({
        idleMs,
        leaveGraceMs,
        hiddenGraceMs,
        limit,
      });
      if (finalized) {
        console.log(
          `[sweep] finalized ${finalized} session(s) — ${byLeave} left, ${byIdle} idle`
        );
      }
    } catch (err) {
      // Never throw out of a timer: an unhandled rejection here would take the
      // whole web task down.
      console.error("[sweep] error:", err.message);
    } finally {
      running = false;
      const elapsed = Date.now() - startedAt;
      if (elapsed > SLOW_TICK_MS) {
        skipNext = true;
        console.warn(`[sweep] tick took ${elapsed}ms; skipping the next one`);
      }
    }
  };

  const timer = setInterval(tick, intervalMs);
  // Don't hold the process open on shutdown.
  timer.unref?.();
  return timer;
}

// Tests run several scenarios in one process.
export function __resetSweepLoopForTests() {
  started = false;
  running = false;
  skipNext = false;
}
