// Why a session has no gaze data.
//
// "0 fixations" is the same number whether nobody looked, the camera was
// refused, the face-detection models failed, the visitor's face was never
// found, or the tab sat in a background where Chrome throttles the
// requestAnimationFrame loop WebGazer runs on. Those need completely different
// responses, and until this existed the only way to tell them apart was to
// query MongoDB by hand — which is exactly how a perfectly healthy pipeline
// came to look broken for an afternoon.
//
// The tag reports raw counters and lets the server decide what they mean, so
// the rule lives here rather than in both places. Plain relative imports and no
// database, so this is testable under bare node.

export const GAZE_OK = "ok";
export const GAZE_NO_FACE = "no_face";
export const GAZE_BLOCKED = "blocked";
export const GAZE_OFF = "off";

// WebGazer calls its listener on every animation frame, handing over null
// whenever it has no prediction. A handful of nulls is just the model warming
// up or the visitor glancing away; this many with nothing to show for them
// means it is not finding a face at all. At ~30fps that is a couple of seconds.
export const NO_FACE_NULL_THRESHOLD = 60;

/**
 * Decide what a tag's gaze counters say about the session.
 *
 * @param {object}  report                     as sent by the tag
 * @param {boolean} [report.enabled]           false once disableGaze() is called
 * @param {boolean} [report.ready]             webgazer.begin() resolved
 * @param {string}  [report.blocked_reason]    why begin() rejected, if it did
 * @param {number}  [report.predictions]       non-null predictions received
 * @param {number}  [report.nulls]             null predictions received
 * @returns {"ok"|"no_face"|"blocked"|"off"|null} null when there is nothing to judge yet
 */
export function deriveGazeStatus(report) {
  if (!report || typeof report !== "object") return null;

  // Switched off deliberately — not a fault, and must not be reported as one.
  if (report.enabled === false) return GAZE_OFF;

  // begin() rejected: camera denied, models unreachable, no getUserMedia.
  // Checked before `ready` because a blocked tag is never ready.
  if (report.blocked_reason) return GAZE_BLOCKED;

  const predictions = toCount(report.predictions);
  const nulls = toCount(report.nulls);

  // One real prediction is enough to prove the whole chain works — camera,
  // models, face. Whether it then produced a *fixation* is a separate question
  // the clusterer answers.
  if (predictions > 0) return GAZE_OK;

  // Ready, running, and handing back nothing but nulls for long enough that it
  // is not just warming up.
  if (nulls >= NO_FACE_NULL_THRESHOLD) return GAZE_NO_FACE;

  // Still early, or the tag has not reported yet. Deliberately not "ok": a
  // session that ends here genuinely has no evidence either way.
  if (report.ready === true) return null;

  return null;
}

function toCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Normalise what the tag sent into the shape the Session schema stores.
 * The tag is untrusted input like any other client payload, so counts are
 * clamped and the reason is truncated rather than stored verbatim.
 */
export function normalizeGazeReport(report) {
  if (!report || typeof report !== "object") return null;
  return {
    status: deriveGazeStatus(report),
    blocked_reason:
      typeof report.blocked_reason === "string" && report.blocked_reason.trim()
        ? report.blocked_reason.trim().slice(0, 200)
        : null,
    counts: {
      predictions: toCount(report.predictions),
      nulls: toCount(report.nulls),
      dropped_outlier: toCount(report.dropped_outlier),
    },
  };
}

/** How the dashboard says it, when it is not "ok". */
export function describeGazeStatus(status) {
  switch (status) {
    case GAZE_BLOCKED:
      return "Camera unavailable";
    case GAZE_NO_FACE:
      return "No face detected";
    case GAZE_OFF:
      return "Gaze off";
    default:
      return null;
  }
}
