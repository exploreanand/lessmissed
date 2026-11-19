// The leave hint: finalizing about a minute after someone closes the tab
// instead of waiting out a 30-minute idle timeout.
//
// The tag beacons `?leaving=1` on pagehide. That is only a hint — pagehide also
// fires for a full-page navigation inside the site — so the hint has a grace
// period, and any event batch or visit from the next page clears it.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, dropTestDb } from "./helpers/db.mjs";

const LIB = "../../Web-App/lessmissed/lib";

let Session, Project, Event, Fixation, sweepIdleSessions;
let available = false;

before(async () => {
  available = await connectTestDb("sweepleave");
  if (!available) return;
  Session = (await import(`${LIB}/models/Session.js`)).default;
  Project = (await import(`${LIB}/models/Project.js`)).default;
  Event = (await import(`${LIB}/models/Event.js`)).default;
  Fixation = (await import(`${LIB}/models/Fixation.js`)).default;
  ({ sweepIdleSessions } = await import(`${LIB}/sessions/sweepIdleSessions.js`));
});

after(dropTestDb);

beforeEach(async () => {
  if (!available) return;
  await Promise.all([
    Session.deleteMany({}), Project.deleteMany({}),
    Event.deleteMany({}), Fixation.deleteMany({}),
  ]);
});

const skipUnlessMongo = (t) => {
  if (!available) {
    t.skip("set CAPTURE_TEST_MONGO_URI to a local mongod to run these");
    return true;
  }
  return false;
};
const objectId = () => new mongoose.Types.ObjectId();

const LEAVE_GRACE_MS = 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;

async function seed({ secondsAgo = 5, leftSecondsAgo = null, kind = "closed" } = {}) {
  const project = await Project.create({
    client_id: objectId(), name: "Test", domain: "example.test",
    pages: [{ path: "/p", slug: "p", target: true }],
  });
  const activity = new Date(Date.now() - secondsAgo * 1000);
  const sessionId = `sess_${Math.random().toString(36).slice(2, 12)}`;
  const session = await Session.create({
    session_id: sessionId,
    consumer_id: objectId(),
    project_id: project._id,
    status: "active",
    started_at: activity,
    last_activity_at: activity,
    left_hint_at: leftSecondsAgo == null ? null : new Date(Date.now() - leftSecondsAgo * 1000),
    left_hint_kind: leftSecondsAgo == null ? null : kind,
    pages_visited: [{ path: "/p", template: "/p", entered_at: activity }],
  });

  const events = [];
  for (let i = 0; i < 20; i++) {
    events.push({
      timestamp: new Date(activity.getTime() + i * 100),
      session_id: sessionId, type: "gaze", page_url: "/p", page_template: "/p",
      data: { viewport_x: 200, viewport_y: 300, scroll_x: 0, scroll_y: 0, element_id: "#hero" },
      metadata: { project_id: project._id, consumer_id: session.consumer_id },
    });
  }
  await Event.insertMany(events);
  return { project, session };
}

test("a hint older than the grace period finalizes the session", async (t) => {
  if (skipUnlessMongo(t)) return;
  const { session } = await seed({ leftSecondsAgo: 120 });

  const result = await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  assert.equal(result.finalized, 1);
  assert.equal(result.byLeave, 1, "it should be attributed to the leave hint, not the idle rule");

  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed");
  assert.ok(done.summary.total_fixations > 0, "fixations must be derived");
});

test("a hint inside the grace period is left alone", async (t) => {
  if (skipUnlessMongo(t)) return;
  const { session } = await seed({ leftSecondsAgo: 5 });

  const result = await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  assert.equal(result.finalized, 0, "a same-site navigation needs time to clear the hint");

  const still = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(still.status, "active");
});

test("a cleared hint is not finalized, however old it was", async (t) => {
  if (skipUnlessMongo(t)) return;
  const { session } = await seed({ leftSecondsAgo: 600 });

  // What the events and visits routes do when the visitor turns out to still
  // be here.
  await Session.updateOne({ session_id: session.session_id }, { $unset: { left_hint_at: "" } });

  const result = await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  assert.equal(result.finalized, 0);
  const still = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(still.status, "active");
  assert.equal(still.left_hint_at ?? null, null);
});

test("the idle rule still finalizes a session whose hint never arrived", async (t) => {
  if (skipUnlessMongo(t)) return;
  // A crashed tab: no pagehide, no beacon, just silence.
  const { session } = await seed({ secondsAgo: 45 * 60 });

  const result = await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  assert.equal(result.finalized, 1);
  assert.equal(result.byIdle, 1);
  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed");
});

test("the session ends when the visitor left, not when the sweep ran", async (t) => {
  if (skipUnlessMongo(t)) return;
  const { session } = await seed({ secondsAgo: 300, leftSecondsAgo: 240 });

  await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  const done = await Session.findOne({ session_id: session.session_id }).lean();

  const leftAt = Date.now() - 240 * 1000;
  assert.ok(
    Math.abs(new Date(done.ended_at).getTime() - leftAt) < 2000,
    `ended_at should be the leave time, got ${done.ended_at}`
  );
  assert.ok(done.duration_ms < 300 * 1000, "duration must not include the grace period");
});

test("the web app's longer thresholds leave sessions for the worker", async (t) => {
  if (skipUnlessMongo(t)) return;
  // A session the capture worker would claim (left 90s ago, idle 35 min) but
  // the web backstop should not, so the 2-vCPU worker does the work whenever
  // it is alive.
  const { session } = await seed({ secondsAgo: 35 * 60, leftSecondsAgo: 70 });

  const web = await sweepIdleSessions({
    idleMs: 45 * 60 * 1000,       // WEB_SWEEP_IDLE_MS
    leaveGraceMs: 90 * 1000,      // WEB_SWEEP_LEAVE_GRACE_MS
  });
  assert.equal(web.finalized, 0, "the web backstop should hold off");

  const worker = await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  assert.equal(worker.finalized, 1, "the worker's shorter thresholds should claim it");
  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed");
});

test("omitting the grace period ignores hints entirely", async (t) => {
  if (skipUnlessMongo(t)) return;
  const { session } = await seed({ leftSecondsAgo: 600 });

  const result = await sweepIdleSessions({ idleMs: IDLE_MS });
  assert.equal(result.finalized, 0, "no leaveGraceMs means the idle rule alone");
  const still = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(still.status, "active");
});

// ─── the two-signal ladder ────────────────────────────────────────────────────
//
// pagehide is unreliable: measured in production it delivered about half the
// time on tab close. visibilitychange-to-hidden is the last moment a browser
// reliably sends anything, so it is the signal that actually arrives — but it
// also fires for a plain tab switch, hence a much longer grace.

const HIDDEN_GRACE_MS = 5 * 60 * 1000;

test("a hidden hint waits far longer than a closed one", async (t) => {
  if (skipUnlessMongo(t)) return;
  // Two minutes after going hidden: past the closed grace, nowhere near the
  // hidden one. A backgrounded tab must not be finalized out from under a
  // visitor who is still there.
  const { session } = await seed({ leftSecondsAgo: 120, kind: "hidden" });

  const early = await sweepIdleSessions({
    idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS, hiddenGraceMs: HIDDEN_GRACE_MS,
  });
  assert.equal(early.finalized, 0, "a tab switch must not finalize the session");
  assert.equal(
    (await Session.findOne({ session_id: session.session_id }).lean()).status,
    "active"
  );
});

test("a hidden hint does finalize once its own grace passes", async (t) => {
  if (skipUnlessMongo(t)) return;
  // This is the path that catches a tab close whose pagehide beacon was
  // dropped — without it that session waits out the 30-minute idle rule.
  const { session } = await seed({ leftSecondsAgo: 400, kind: "hidden" });

  const result = await sweepIdleSessions({
    idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS, hiddenGraceMs: HIDDEN_GRACE_MS,
  });
  assert.equal(result.finalized, 1);
  assert.equal(result.byLeave, 1);

  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed");
  assert.ok(done.summary.total_fixations > 0, "fixations must be derived");
});

test("a hint with no kind is treated as closed", async (t) => {
  if (skipUnlessMongo(t)) return;
  // Sessions whose hint was written by a tag that only ever sent pagehide.
  const { session } = await seed({ leftSecondsAgo: 120, kind: "closed" });
  await Session.updateOne(
    { session_id: session.session_id },
    { $unset: { left_hint_kind: "" } }
  );

  const result = await sweepIdleSessions({
    idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS, hiddenGraceMs: HIDDEN_GRACE_MS,
  });
  assert.equal(result.finalized, 1, "a kindless hint must still use the short grace");
});

test("hiddenGraceMs defaults to a multiple of the closed grace", async (t) => {
  if (skipUnlessMongo(t)) return;
  // Callers that pass only leaveGraceMs must not accidentally get the short
  // grace applied to hidden hints.
  const { session } = await seed({ leftSecondsAgo: 120, kind: "hidden" });

  const result = await sweepIdleSessions({ idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS });
  assert.equal(result.finalized, 0, "hidden must not inherit the 60s grace");
  assert.equal(
    (await Session.findOne({ session_id: session.session_id }).lean()).status,
    "active"
  );
});

test("both hint kinds are picked up in one sweep", async (t) => {
  if (skipUnlessMongo(t)) return;
  const a = await seed({ leftSecondsAgo: 120, kind: "closed" });
  const b = await seed({ leftSecondsAgo: 400, kind: "hidden" });

  const result = await sweepIdleSessions({
    idleMs: IDLE_MS, leaveGraceMs: LEAVE_GRACE_MS, hiddenGraceMs: HIDDEN_GRACE_MS, limit: 10,
  });
  assert.equal(result.finalized, 2);
  for (const { session } of [a, b]) {
    assert.equal(
      (await Session.findOne({ session_id: session.session_id }).lean()).status,
      "completed"
    );
  }
});
