// Finalize leases.
//
// A session used to be claimed for finalization by flipping its status straight
// to "completed" (sweepIdleSessions.js), before any of the work that word
// implies had been done. Finalization is not quick — it reads every gaze sample
// of the session, clusters them, scores engagement and rolls counters up onto
// the project — and it runs in processes that get killed: the capture worker is
// a single Fargate Spot task, and a web task can be replaced by a deploy. Dying
// in that gap left the session "completed" with zero fixations and, because
// every sweep query filters on status "active", permanently unreachable.
//
// So: claim with a lease and leave the status alone. The status becomes
// "completed" only once the work behind it has succeeded. A holder that dies
// lets its lease expire and the next sweep picks the session up again.
//
// Same idiom as the capture queue's job lease (capture-service/src/queue.js) —
// deliberately, because it is the pattern this codebase already reasons about.
//
// Plain relative imports (with .js) so the capture worker, which has no
// bundler, can load this. Same constraint as finalizeSession.js.
import Session from "../models/Session.js";

// Long enough for a slow finalize on a free-tier cluster, short enough that a
// killed holder's session is retried within a sweep cycle or two.
export const FINALIZE_LEASE_MS = 2 * 60 * 1000;

// After this many tries a session is completed regardless, with a logged error.
// One session that always throws must not be retried forever at the cost of
// every session queued behind it. The capture queue gives up the same way.
export const MAX_FINALIZE_ATTEMPTS = 5;

/**
 * Take the finalize lease on a session, if it is free.
 *
 * @param {object} filter extra conditions — `{ _id }` or `{ session_id }`
 * @returns {Promise<object|null>} the hydrated session, or null if someone else
 *   holds the lease or the session is no longer active
 */
export async function claimForFinalize(filter) {
  const now = new Date();
  return Session.findOneAndUpdate(
    {
      ...filter,
      status: "active",
      $or: [
        { finalize_lease_until: null },
        { finalize_lease_until: { $lt: now } },
      ],
    },
    {
      $set: { finalize_lease_until: new Date(now.getTime() + FINALIZE_LEASE_MS) },
      $inc: { finalize_attempts: 1 },
    },
    { returnDocument: "after" }
  );
}

/**
 * Drop the lease without completing, so the session is swept again promptly
 * rather than after the lease expires. Best-effort: if this fails the lease
 * simply times out, which is the same outcome a crash would produce.
 */
export async function releaseFinalizeClaim(sessionId) {
  try {
    await Session.updateOne(
      { session_id: sessionId, status: "active" },
      { $set: { finalize_lease_until: null } }
    );
  } catch (err) {
    console.error(`[finalize] could not release lease for ${sessionId}:`, err.message);
  }
}

/**
 * Has this session failed to finalize so often that we should stop trying?
 * `finalize_attempts` is incremented by the claim, so the current attempt is
 * already counted.
 */
export function isPoisoned(session) {
  return (session.finalize_attempts ?? 0) >= MAX_FINALIZE_ATTEMPTS;
}
