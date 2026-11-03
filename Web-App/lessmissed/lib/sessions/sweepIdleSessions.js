// Idle-session sweeper.
//
// The tag can't reliably finalize a session on its own: `pagehide` may just be
// a same-site navigation (the session should continue), and a tab close fires
// nothing usable. So a visitor who simply leaves would keep their session
// "active" forever and never get fixations, engagement, or page rollups — which
// is exactly why gaze/insights appeared empty until a manual `LessMissed.stop()`.
//
// This finds sessions whose last ingest is old enough that the visitor has
// clearly gone and runs the same finalize path the PATCH route uses, so the
// numbers can't drift between "stopped explicitly" and "timed out".
//
// Plain ESM with relative imports (see deriveFixations.js / finalizeSession.js)
// so the always-on, single-instance capture worker can run it.
import Session from "../models/Session.js";
import { finalizeSessionAndRollup } from "./finalizeSession.js";

export async function sweepIdleSessions({ idleMs, limit = 100 } = {}) {
  if (!idleMs || idleMs <= 0) return 0;
  const cutoff = new Date(Date.now() - idleMs);

  const stale = await Session.find({
    status: "active",
    $or: [
      { last_activity_at: { $lt: cutoff } },
      { last_activity_at: null, started_at: { $lt: cutoff } },
    ],
  })
    .sort({ last_activity_at: 1 })
    .limit(limit);

  let finalized = 0;
  for (const session of stale) {
    // Claim the row atomically before doing any work: only the updater that
    // flips active -> completed runs the finalize, so overlapping sweeps (or a
    // future second worker) can't write duplicate fixations. Null means someone
    // else already took it — the tag's own stop, or a prior sweep.
    const claimed = await Session.findOneAndUpdate(
      { _id: session._id, status: "active" },
      { $set: { status: "completed" } }
    );
    if (!claimed) continue;

    // End the session at its last real activity, not "now" — duration and the
    // per-visit time windows should reflect when the visitor actually left.
    const endedAt = session.last_activity_at
      ? new Date(session.last_activity_at)
      : new Date(session.started_at);
    try {
      await finalizeSessionAndRollup(session, endedAt);
      finalized++;
    } catch (err) {
      console.error(
        `[sweep] finalize failed for ${session.session_id}:`,
        err.message
      );
    }
  }
  return finalized;
}
