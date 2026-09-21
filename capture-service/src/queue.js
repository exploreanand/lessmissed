// Leasing a job, keeping it alive, and giving it back.
//
// The whole point of this module is that no crash can lose work. A worker never
// removes a job; it moves it to "leased" with an expiry and updates that expiry
// while it works. If the process dies, the lease simply lapses and `reapExpired`
// returns the job to the queue. The previous design kept its queue in an array
// inside an MV3 service worker, which Chrome terminates at will — which is
// precisely why a failed capture used to vanish without trace.

import CaptureJob from "../../Web-App/lessmissed/lib/models/CaptureJob.js";
import { config } from "./config.js";

// The producer half lives in the web app, because the API routes are what
// normally create work. Re-exported here so the worker and its tests have one
// place to import the queue from, and so there is only ever one definition of
// what enqueuing means.
export { enqueueCapture as enqueue, defaultPriority } from "../../Web-App/lessmissed/lib/capture/enqueue.js";

/** Retry backoff: 1 min, 5 min, 25 min. Capped so a job cannot drift for days. */
function backoffMs(attempts) {
  return Math.min(60_000 * Math.pow(5, Math.max(0, attempts - 1)), 60 * 60_000);
}

/**
 * Claim the best eligible job, atomically.
 *
 * `findOneAndUpdate` with the status in the filter is what makes this safe
 * against other workers: the status transition and the selection are one
 * operation, so two workers polling simultaneously cannot both win the same
 * document — the loser's filter no longer matches.
 *
 * @returns {Promise<object|null>} the leased job, or null if nothing is due
 */
export async function leaseJob(workerId = config.workerId) {
  const now = new Date();
  return CaptureJob.findOneAndUpdate(
    { status: "queued", run_after: { $lte: now } },
    {
      $set: {
        status: "leased",
        worker_id: workerId,
        leased_at: now,
        lease_expires_at: new Date(now.getTime() + config.leaseSeconds * 1000),
      },
      $inc: { attempts: 1 },
    },
    // Highest priority first, then oldest — so a human waiting on a thumbnail
    // overtakes the nightly drift backlog, but nothing inside a priority band
    // can starve.
    { sort: { priority: -1, run_after: 1 }, new: true }
  ).lean();
}

/**
 * Push the lease expiry out while a long render is still going.
 *
 * Guarded on worker_id: a worker whose lease already lapsed and was reaped must
 * not be able to reclaim the job by heartbeating it, or two workers would write
 * captures for the same page. A false return means "you no longer own this" and
 * the caller should abandon the render.
 */
export async function heartbeat(jobId, workerId = config.workerId) {
  const result = await CaptureJob.updateOne(
    { _id: jobId, status: "leased", worker_id: workerId },
    { $set: { lease_expires_at: new Date(Date.now() + config.leaseSeconds * 1000) } }
  );
  return result.matchedCount === 1;
}

/** Mark a job done and record what it produced. */
export async function completeJob(jobId, captureId, workerId = config.workerId) {
  await CaptureJob.updateOne(
    { _id: jobId, worker_id: workerId },
    {
      $set: {
        status: "succeeded",
        capture_id: captureId ?? null,
        lease_expires_at: null,
        last_error: null,
      },
    }
  );
}

/**
 * Hand a failed job back — for another attempt if it has any left, otherwise
 * to "dead".
 *
 * "dead" rather than deleted: a page whose capture keeps failing is something
 * the admin needs to see and act on, and the attempt history is the evidence
 * for why it was auto-paused.
 */
export async function failJob(jobId, error, workerId = config.workerId, options = {}) {
  const job = await CaptureJob.findOne({ _id: jobId }).lean();
  if (!job) return { retrying: false, dead: true };

  const message = String(error?.message ?? error).slice(0, 1000);
  // Some failures can never succeed on a retry — a deleted project, a page
  // with no URL. Burning three attempts and a backoff window on those just
  // keeps a doomed job cycling through the queue.
  const exhausted = options.permanent === true || job.attempts >= job.max_attempts;

  await CaptureJob.updateOne(
    { _id: jobId, worker_id: workerId },
    {
      $set: {
        status: exhausted ? "dead" : "queued",
        last_error: message,
        lease_expires_at: null,
        worker_id: null,
        ...(exhausted ? {} : { run_after: new Date(Date.now() + backoffMs(job.attempts)) }),
      },
    }
  );

  return { retrying: !exhausted, dead: exhausted };
}

/**
 * Return jobs whose worker went away.
 *
 * Runs on every poll cycle. Cheap: it is an indexed query over leased jobs only,
 * and in the normal case matches nothing.
 */
export async function reapExpired() {
  const result = await CaptureJob.updateMany(
    { status: "leased", lease_expires_at: { $lt: new Date() } },
    { $set: { status: "queued", worker_id: null, lease_expires_at: null } }
  );
  return result.modifiedCount ?? 0;
}
