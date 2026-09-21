// Executing one capture job, end to end.
//
// The interesting decision lives here: having gone to the trouble of rendering
// a page, the worker often throws the image away. If the new render is visually
// indistinguishable from the current baseline, storing it would add a version
// nobody can tell apart from the last one, invalidate the region map for no
// reason, and cost storage forever. "Rendered, compared, discarded" is a
// first-class outcome rather than a failure.

import mongoose from "mongoose";
import Project from "../../Web-App/lessmissed/lib/models/Project.js";
import PageCapture from "../../Web-App/lessmissed/lib/models/PageCapture.js";
import { profileFor } from "../../Web-App/lessmissed/lib/capture/breakpoints.js";
import { UnsafeUrlError } from "../../Web-App/lessmissed/lib/capture/urlSafety.js";
import { renderPage, RenderError } from "./render.js";
import { contentHash, isContentHashReliable, perceptualHash, imageDiff } from "./diff.js";
import { putCapture, getCapture, deleteKeys, captureKey } from "./store.js";
import { config } from "./config.js";

/**
 * @param {object} job a leased CaptureJob
 * @param {import("./render.js").BrowserPool} pool
 * @param {() => Promise<boolean>} heartbeat returns false if the lease was lost
 */
export async function runCaptureJob(job, pool, heartbeat) {
  // These three are permanent: a deleted project is not going to come back,
  // so retrying three times with backoff only delays the inevitable and keeps
  // a dead row cycling through the queue. RenderError carries the code the
  // worker uses to skip straight to "dead".
  const project = await Project.findById(job.project_id).lean();
  if (!project) {
    throw new RenderError(`Project ${job.project_id} no longer exists`, "gone");
  }

  const page = (project.pages ?? []).find((p) => String(p._id) === String(job.page_id));
  if (!page) {
    throw new RenderError(`Page ${job.page_id} no longer exists on this project`, "gone");
  }

  const url = page.capture_url;
  if (!url) {
    throw new RenderError(`Page ${page.slug} has no URL configured`, "no_url");
  }

  await setPageStatus(project._id, page._id, { screenshot_status: "capturing" });

  const captureId = new mongoose.Types.ObjectId();
  const previous = await currentCapture(page, job.breakpoint);

  let render;
  try {
    render = await renderPage({
      pool,
      url,
      breakpoint: job.breakpoint,
      maskSelectors: page.mask_selectors ?? [],
      dismissSelectors: page.dismiss_selectors ?? [],
      expectedHostname: project.domain,
      onProgress: () => { heartbeat().catch(() => {}); },
    });
  } catch (err) {
    await recordFailure(project._id, page._id, job, captureId, err);
    throw err;
  }

  // The dimension check the old upload endpoint never performed. Everything
  // downstream — HeatmapViewer's scaling, firstFixation's percentages,
  // relabel-pages' sharp.extract crops — assumes image pixels are document CSS
  // pixels. If that is not true, silently storing the image corrupts every
  // insight drawn on it, so it is better to fail loudly.
  assertGeometry(render);

  const nextHash = contentHash(render.html);
  const nextPhash = await perceptualHash(render.buffer);

  let diff = { changedPct: null, changedBoxes: [], heightChanged: false };
  let discard = false;

  if (previous?.s3_key) {
    try {
      const previousBuffer = await getCapture(previous.s3_key);
      diff = await imageDiff(previousBuffer, render.buffer);

      // A manual recapture always produces a version: an admin who clicked the
      // button is entitled to evidence that something happened, even if the
      // page turned out to be identical.
      //
      // Nor is a render discarded when the version it would be discarded in
      // favour of has no element inventory. The pixels may be unchanged, but
      // this render carries the inventory "missed elements" is counted against,
      // and throwing it away would leave that metric unknown indefinitely.
      discard =
        job.reason !== "manual" &&
        diff.changedPct < config.diffThresholdPct &&
        Array.isArray(previous.elements);
    } catch (err) {
      // A missing or unreadable baseline is not a reason to lose a good render.
      console.warn(`[capture] could not diff against ${previous.s3_key}: ${err.message}`);
    }
  }

  if (discard) {
    await PageCapture.create({
      project_id: project._id,
      page_id: page._id,
      capture_url: url,
      breakpoint: job.breakpoint,
      status: "discarded_no_change",
      reason: job.reason,
      content_hash: nextHash,
      perceptual_hash: nextPhash,
      diff_vs_previous: {
        changed_pct: diff.changedPct,
        changed_boxes: [],
        height_changed: diff.heightChanged,
      },
      previous_capture_id: previous?._id ?? null,
      duration_ms: render.durationMs,
      captured_at: new Date(),
    });

    await setPageStatus(project._id, page._id, {
      screenshot_status: "captured",
      last_checked_at: new Date(),
      availability_status: "ok",
      availability_error: null,
      content_hash_reliable: isContentHashReliable(render.html, ""),
    });

    return { captureId: null, discarded: true, changedPct: diff.changedPct };
  }

  const { key, thumbKey, bytes } = await putCapture({
    projectId: project._id,
    pageId: page._id,
    captureId,
    buffer: render.buffer,
    thumbnail: render.thumbnail,
  });

  const capture = await PageCapture.create({
    _id: captureId,
    project_id: project._id,
    page_id: page._id,
    capture_url: url,
    breakpoint: job.breakpoint,
    viewport_width: render.viewportWidth,
    viewport_height: render.viewportHeight,
    device_scale_factor: render.deviceScaleFactor,
    document_height: render.documentHeight,
    captured_height: render.captureHeight,
    truncated: render.truncated,
    image_width: render.imageWidth,
    image_height: render.imageHeight,
    elements: render.elements ?? null,
    s3_key: key,
    thumb_key: thumbKey,
    bytes,
    content_hash: nextHash,
    perceptual_hash: nextPhash,
    status: "succeeded",
    reason: job.reason,
    diff_vs_previous: {
      changed_pct: diff.changedPct,
      changed_boxes: diff.changedBoxes,
      height_changed: diff.heightChanged,
    },
    previous_capture_id: previous?._id ?? null,
    duration_ms: render.durationMs,
    captured_at: new Date(),
  });

  await promoteCapture(project._id, page._id, job.breakpoint, capture, render);
  await pruneOldVersions(project._id, page._id, job.breakpoint);

  return { captureId: capture._id, discarded: false, changedPct: diff.changedPct };
}

/**
 * The coordinate contract, enforced.
 *
 * A render whose encoded dimensions do not match the layout it was measured at
 * cannot be drawn on. Allow one pixel of rounding on the height, because a
 * fractional CSS document height rounds when it becomes a raster row.
 */
function assertGeometry(render) {
  const expectedHeight = render.captureHeight;
  if (render.imageWidth !== render.viewportWidth) {
    throw new RenderError(
      `Image width ${render.imageWidth} does not match viewport ${render.viewportWidth}`,
      "geometry_mismatch"
    );
  }
  if (Math.abs(render.imageHeight - expectedHeight) > 1) {
    throw new RenderError(
      `Image height ${render.imageHeight} does not match document ${expectedHeight}`,
      "geometry_mismatch"
    );
  }
}

async function currentCapture(page, breakpoint) {
  const id = page.current_capture?.[breakpoint];
  if (id) {
    const found = await PageCapture.findById(id).lean();
    if (found) return found;
  }
  // Fall back to the newest successful capture — covers a page whose pointer
  // was never set, such as one migrated from the old flat fields.
  return PageCapture.findOne({
    page_id: page._id,
    breakpoint,
    status: "succeeded",
  })
    .sort({ captured_at: -1 })
    .lean();
}

/**
 * Point the page at its new capture.
 *
 * The deprecated flat `screenshot_*` fields are written alongside the pointer
 * for one release, so HeatmapViewer and relabel-pages.mjs keep working
 * untouched while reads are migrated. Only the desktop breakpoint feeds them:
 * they predate the concept and mean "the" screenshot.
 */
async function promoteCapture(projectId, pageId, breakpoint, capture, render) {
  const update = {
    [`pages.$.current_capture.${breakpoint}`]: capture._id,
    "pages.$.screenshot_status": "captured",
    "pages.$.last_checked_at": new Date(),
    "pages.$.availability_status": "ok",
    "pages.$.availability_error": null,
    "pages.$.content_hash_reliable": isContentHashReliable(render.html, ""),
  };

  if (breakpoint === "desktop") {
    Object.assign(update, {
      "pages.$.screenshot_url": `${config.s3.baseUrl}/${capture.s3_key}`,
      "pages.$.screenshot_viewport_width": capture.viewport_width,
      "pages.$.screenshot_viewport_height": capture.viewport_height,
      // The height the IMAGE spans, not the page's full height. HeatmapViewer
      // scales every overlay by this, so on a truncated capture the honest
      // document height would stretch the canvas past the image and misplace
      // every point below the fold.
      "pages.$.screenshot_document_height": capture.captured_height ?? capture.document_height,
      "pages.$.screenshot_captured_at": capture.captured_at,
      // Clear the legacy sticky-nav overlay.
      //
      // The old extension hid every fixed element before stitching, so the nav
      // was missing from the body image and had to be re-pasted over the top as
      // a separate strip. A fullPage render has no such problem: the nav is
      // already in the image, at its natural position. Leaving a stale header
      // URL behind would paste an old capture's navbar over the new screenshot
      // and draw the nav twice.
      "pages.$.screenshot_header_url": null,
      "pages.$.screenshot_header_height": null,
    });
  }

  await Project.updateOne({ _id: projectId, "pages._id": pageId }, { $set: update });
}

/**
 * Keep the current baseline plus a bounded history.
 *
 * A version still cited by a region map is never pruned: those bboxes were
 * measured against that exact image, and deleting it would leave labels
 * pointing at nothing — the failure the old overwrite-in-place design caused on
 * every single capture.
 */
async function pruneOldVersions(projectId, pageId, breakpoint) {
  const versions = await PageCapture.find({
    page_id: pageId,
    breakpoint,
    status: "succeeded",
  })
    .sort({ captured_at: -1 })
    .lean();

  if (versions.length <= config.keepVersions) return 0;

  const project = await Project.findById(projectId).lean();
  const page = (project?.pages ?? []).find((p) => String(p._id) === String(pageId));
  const cited = new Set(
    (page?.regions ?? []).map((r) => String(r.capture_id)).filter(Boolean)
  );

  const stale = versions
    .slice(config.keepVersions)
    .filter((capture) => !cited.has(String(capture._id)));

  if (!stale.length) return 0;

  await deleteKeys(stale.flatMap((c) => [c.s3_key, c.thumb_key]));
  await PageCapture.deleteMany({ _id: { $in: stale.map((c) => c._id) } });
  return stale.length;
}

async function recordFailure(projectId, pageId, job, captureId, err) {
  const availability =
    err instanceof RenderError && err.code === "not_found"
      ? "not_found"
      : err instanceof UnsafeUrlError
        ? "unreachable"
        : "unreachable";

  await PageCapture.create({
    _id: captureId,
    project_id: projectId,
    page_id: pageId,
    capture_url: job.capture_url ?? "",
    breakpoint: job.breakpoint,
    status: "failed",
    reason: job.reason,
    error: String(err?.message ?? err).slice(0, 1000),
    captured_at: new Date(),
  }).catch(() => {});

  // Only the final attempt marks the page itself — a first transient failure
  // that a retry fixes should not flip a page to "unreachable" in the UI.
  if (job.attempts >= job.max_attempts) {
    await setPageStatus(projectId, pageId, {
      screenshot_status: "failed",
      availability_status: availability,
      availability_error: String(err?.message ?? err).slice(0, 500),
      last_checked_at: new Date(),
    });
  }
}

async function setPageStatus(projectId, pageId, fields) {
  const update = {};
  for (const [key, value] of Object.entries(fields)) update[`pages.$.${key}`] = value;
  await Project.updateOne({ _id: projectId, "pages._id": pageId }, { $set: update });
}
