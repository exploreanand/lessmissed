// Asking for a capture.
//
// The producer half of the queue, kept here rather than in capture-service so
// the Next API routes and the worker share one definition of what enqueuing
// means. Plain relative imports, no "@/" alias, so bare Node can load it too —
// the same constraint pathTemplate.js and deriveFixations.js work under.

import CaptureJob from "../models/CaptureJob.js";

/**
 * How urgently should this run?
 *
 * Someone watching a spinner outranks a nightly sweep. Without this a single
 * project's drift backlog would push every new admin's first capture to the
 * back of the queue, and onboarding would feel broken.
 */
export function defaultPriority(reason) {
  switch (reason) {
    case "manual":
      return 30; // an admin is watching
    case "baseline":
      return 20; // the page is unusable until this lands
    case "drift":
      return 10;
    default:
      return 0; // scheduled sweeps fill idle time
  }
}

/**
 * Enqueue a capture, unless one is already pending for the same page and
 * breakpoint.
 *
 * Deduplication matters because the three triggers are independent: a nightly
 * drift check, a staleness sweep and an impatient admin can all decide the same
 * page needs re-rendering inside a minute. Rendering it three times would cost
 * three browsers and produce at most one new version.
 *
 * An existing job is promoted rather than duplicated, so clicking "Recapture"
 * while a scheduled job is already queued does what the admin expects — it
 * jumps the queue — without creating a second render.
 */
export async function enqueueCapture({
  projectId,
  pageId,
  breakpoint = "desktop",
  reason,
  priority,
}) {
  const resolvedPriority = priority ?? defaultPriority(reason);

  const existing = await CaptureJob.findOne({
    page_id: pageId,
    breakpoint,
    status: { $in: ["queued", "leased"] },
  }).lean();

  if (existing) {
    // Only a still-queued job can be promoted. One already leased is being
    // rendered right now, and changing its priority would achieve nothing.
    if (resolvedPriority > existing.priority) {
      await CaptureJob.updateOne(
        { _id: existing._id, status: "queued" },
        { $set: { priority: resolvedPriority, reason, run_after: new Date() } }
      );
    }
    return { job: existing, created: false };
  }

  const job = await CaptureJob.create({
    project_id: projectId,
    page_id: pageId,
    breakpoint,
    reason,
    priority: resolvedPriority,
    run_after: new Date(),
  });

  return { job: job.toObject(), created: true };
}
