// What a session's missing gaze data means.
//
// Regression for an afternoon spent proving a healthy pipeline was healthy: a
// session showing "0 fixations" is indistinguishable from a broken clusterer
// unless something records *why* there was no gaze. These are the rules that
// tell those apart, so they must never skip — no database here.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib";
const {
  deriveGazeStatus,
  normalizeGazeReport,
  describeGazeStatus,
  NO_FACE_NULL_THRESHOLD,
  GAZE_OK,
  GAZE_NO_FACE,
  GAZE_BLOCKED,
  GAZE_OFF,
} = await import(`${LIB}/gaze/gazeStatus.js`);

test("a single real prediction proves the chain works", () => {
  // Camera, models and face detection all have to succeed to get even one.
  assert.equal(deriveGazeStatus({ ready: true, predictions: 1, nulls: 0 }), GAZE_OK);
  // Still ok when most frames are nulls — people look away constantly.
  assert.equal(
    deriveGazeStatus({ ready: true, predictions: 12, nulls: 5000 }),
    GAZE_OK
  );
});

test("nulls with nothing to show for them become no_face", () => {
  // The exact shape of the incident this was built for: ready, camera
  // delivering frames, every prediction null.
  assert.equal(
    deriveGazeStatus({ ready: true, predictions: 0, nulls: NO_FACE_NULL_THRESHOLD }),
    GAZE_NO_FACE
  );
});

test("a few early nulls are not yet a verdict", () => {
  // Warming up, or the visitor glanced away in the first second. Calling this
  // no_face would cry wolf on every session's opening moments.
  assert.equal(
    deriveGazeStatus({ ready: true, predictions: 0, nulls: NO_FACE_NULL_THRESHOLD - 1 }),
    null
  );
});

test("a rejected begin() is blocked, whatever the counters say", () => {
  assert.equal(
    deriveGazeStatus({ ready: false, blocked_reason: "Permission denied", nulls: 0 }),
    GAZE_BLOCKED
  );
  // Blocked outranks a stale null count from before it failed.
  assert.equal(
    deriveGazeStatus({ ready: false, blocked_reason: "model fetch failed", nulls: 9999 }),
    GAZE_BLOCKED
  );
});

test("gaze switched off deliberately is not a fault", () => {
  // disableGaze() is a feature. Reporting it as no_face would send someone
  // hunting a camera problem that does not exist.
  assert.equal(
    deriveGazeStatus({ enabled: false, ready: false, nulls: 9999 }),
    GAZE_OFF
  );
  assert.equal(
    deriveGazeStatus({ enabled: false, blocked_reason: "denied" }),
    GAZE_OFF,
    "off outranks blocked — we never asked for the camera"
  );
});

test("nothing reported yields no verdict rather than a guess", () => {
  for (const input of [null, undefined, {}, "nonsense", 42]) {
    assert.equal(deriveGazeStatus(input), null, `input ${JSON.stringify(input)}`);
  }
});

test("counters from the tag are treated as untrusted input", () => {
  const n = normalizeGazeReport({
    ready: true,
    predictions: -5,
    nulls: 1.9,
    dropped_outlier: "12",
    blocked_reason: "   ",
  });
  assert.deepEqual(n.counts, {
    predictions: 0,
    nulls: 1,
    dropped_outlier: 0,
    training_clicks: 0,
  });
  assert.equal(n.blocked_reason, null, "a whitespace-only reason is not a reason");
});

test("a blocked reason is truncated, not stored verbatim", () => {
  const n = normalizeGazeReport({ blocked_reason: "x".repeat(5000) });
  assert.equal(n.blocked_reason.length, 200);
  assert.equal(n.status, GAZE_BLOCKED);
});

test("every non-ok status has wording for the dashboard", () => {
  for (const s of [GAZE_BLOCKED, GAZE_NO_FACE, GAZE_OFF]) {
    assert.equal(typeof describeGazeStatus(s), "string", `${s} needs wording`);
  }
  // "ok" and "unknown" fall through to the real fixation count.
  assert.equal(describeGazeStatus(GAZE_OK), null);
  assert.equal(describeGazeStatus(null), null);
});

// WebGazer's ridge regression:
//
//   predict = function (e) { if (!e || 0 === this.eyeFeaturesClicks.length) return null; ... }
//
// Both arms of that `||` emit an identical stream of nulls. Telling them apart
// is the whole point — one means check the webcam, the other means the model
// was never trained and the webcam is irrelevant.
test("nulls with no training clicks is uncalibrated, not a camera fault", () => {
  const status = deriveGazeStatus({
    ready: true,
    predictions: 0,
    nulls: 5191,
    training_clicks: 0,
  });
  assert.equal(status, "uncalibrated");
  assert.equal(describeGazeStatus(status), "Not calibrated yet");
});

test("the same nulls with training clicks behind them is a camera fault", () => {
  const status = deriveGazeStatus({
    ready: true,
    predictions: 0,
    nulls: 5191,
    training_clicks: 7,
  });
  assert.equal(status, "no_face");
  assert.equal(describeGazeStatus(status), "No face detected");
});

test("a trained-but-unseen face and an untrained model differ only in that field", () => {
  const base = { ready: true, predictions: 0, nulls: 5191 };
  assert.notEqual(
    deriveGazeStatus({ ...base, training_clicks: 0 }),
    deriveGazeStatus({ ...base, training_clicks: 1 }),
    "one click is the entire difference between the two diagnoses"
  );
});

test("one real prediction outranks an untrained model", () => {
  // Ordering guard: predictions > 0 must win before the training_clicks branch
  // is consulted, or a session carrying loaded calibration would be called
  // uncalibrated for not having clicked yet this visit.
  assert.equal(
    deriveGazeStatus({ ready: true, predictions: 12, nulls: 9000, training_clicks: 0 }),
    "ok"
  );
});
