// Idle-session sweeper.
//
// The tag can't reliably finalize a session on its own: `pagehide` may just be
// a same-site navigation (the session should continue), and a tab close fires
// nothing that can be trusted on its own. So a visitor who simply leaves would
// keep their session "active" forever and never get fixations, engagement, or
// page rollups — which is exactly why gaze/insights appeared empty until a
// manual `LessMissed.stop()`.
//
// Two ways a session gets picked up here:
//
//   "closed" hint  the tag beaconed a pagehide that was not a back/forward
//                  cache entry. Short grace: only a same-site navigation has
//                  to be waited out, and that clears the hint within a second.
//   "hidden" hint  visibilitychange to hidden — the last moment a browser
//                  reliably delivers anything, so this is the signal that
//                  actually arrives when a pagehide beacon gets dropped on tab
//                  close. But it also fires for a plain tab switch, so it gets
//                  a much longer grace; a visitor who comes back clears it on
//                  their next batch, which is within a second since gaze
//                  resumes.
//   last_activity  nothing at all for idleMs. The long backstop, for sessions
//                  where neither hint arrived — a crashed tab, a killed
//                  browser, a device that lost power.
//
// Both run the same finalize path the PATCH route uses, so the numbers can't
// drift between "stopped explicitly" and "timed out".
//
// Plain ESM with relative imports (see deriveFixations.js / finalizeSession.js)
// so the always-on capture worker and the web app's own sweep loop can both run
// it.
import Session from "../models/Session.js";
import { finalizeSessionAndRollup } from "./finalizeSession.js";
import { claimForFinalize, releaseFinalizeClaim, isPoisoned } from "./claimSession.js";

/**
 * Finalize sessions whose visitors have gone.
 *
 * @param {object}  opts
 * @param {number}  opts.idleMs         finalize after this much silence
 * @param {number} [opts.leaveGraceMs]  grace for a "closed" hint; omit to ignore hints
 * @param {number} [opts.hiddenGraceMs] grace for a "hidden" hint; defaults to 5x leaveGraceMs
 * @param {number} [opts.limit]         most sessions to finalize per call
 * @returns {Promise<{finalized: number, byLeave: number, byIdle: number}>}
 */
export async function sweepIdleSessions({
  idleMs,
  leaveGraceMs,
  hiddenGraceMs,
  limit = 100,
} = {}) {
  const now = Date.now();
  const candidates = [];
  const seen = new Set();

  // Separate queries rather than more arms on one $or: each matches an index
  // outright ({status, left_hint_at} and {status, last_activity_at}) instead of
  // leaving the planner to union them.
  if (leaveGraceMs > 0) {
    const hiddenGrace = hiddenGraceMs ?? leaveGraceMs * 5;
    const hintQueries = [
      // A hint with no kind came from a tag that only ever sent pagehide.
      {
        status: "active",
        left_hint_at: { $ne: null, $lt: new Date(now - leaveGraceMs) },
        left_hint_kind: { $in: ["closed", null] },
      },
      {
        status: "active",
        left_hint_at: { $ne: null, $lt: new Date(now - hiddenGrace) },
        left_hint_kind: "hidden",
      },
    ];

    for (const query of hintQueries) {
      if (candidates.length >= limit) break;
      const leaving = await Session.find(query)
        .sort({ left_hint_at: 1 })
        .limit(limit - candidates.length)
        .select("_id session_id")
        .lean();
      for (const s of leaving) {
        if (seen.has(String(s._id))) continue;
        seen.add(String(s._id));
        candidates.push({ id: s._id, reason: "leave" });
      }
    }
  }

  if (idleMs > 0 && candidates.length < limit) {
    const idle = await Session.find({
      status: "active",
      $or: [
        { last_activity_at: { $lt: new Date(now - idleMs) } },
        { last_activity_at: null, started_at: { $lt: new Date(now - idleMs) } },
      ],
    })
      .sort({ last_activity_at: 1 })
      .limit(limit - candidates.length)
      .select("_id session_id")
      .lean();
    for (const s of idle) {
      if (seen.has(String(s._id))) continue;
      candidates.push({ id: s._id, reason: "idle" });
    }
  }

  let finalized = 0;
  let byLeave = 0;
  let byIdle = 0;

  for (const candidate of candidates) {
    // Take the lease before doing any work. The session stays "active" until
    // the work has actually succeeded, so a process killed mid-finalize — a
    // Spot reclaim, a deploy — leaves it to be retried rather than stranding it
    // as "completed" with no fixations, which no later sweep could ever find.
    // Null means someone else holds it: another sweeper, or the tag's own stop.
    const session = await claimForFinalize({ _id: candidate.id });
    if (!session) continue;

    // End the session at the moment it actually ended, not "now" — duration and
    // the per-visit time windows should reflect when the visitor left. The
    // leave hint is the better clock when we have it.
    const endedAt = new Date(
      session.left_hint_at ?? session.last_activity_at ?? session.started_at
    );

    try {
      await finalizeSessionAndRollup(session, endedAt, { giveUp: isPoisoned(session) });
      finalized++;
      if (candidate.reason === "leave") byLeave++;
      else byIdle++;
    } catch (err) {
      // Leave it active and drop the lease so the next sweep retries it.
      console.error(
        `[sweep] finalize failed for ${session.session_id} (attempt ${session.finalize_attempts}):`,
        err.message
      );
      await releaseFinalizeClaim(session.session_id);
    }
  }

  return { finalized, byLeave, byIdle };
}
