// Finalization must be safe to retry.
//
// Regression for the failure that silently and permanently destroyed sessions:
// the sweeper claimed a session by flipping its status straight to "completed",
// then did the work. Anything that killed the process in between — a Fargate
// Spot reclaim, a deploy, a throw out of derivation — left the session
// "completed" with zero fixations, and because every sweep query filters on
// status "active", nothing could ever pick it up again.
//
// Claiming is now a lease; "completed" is written only once the work succeeded.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, dropTestDb } from "./helpers/db.mjs";

const LIB = "../../Web-App/lessmissed/lib";

let Session, Project, Event, Fixation;
let sweepIdleSessions, finalizeSessionAndRollup, claimForFinalize;
let available = false;

before(async () => {
  available = await connectTestDb("finalizeretry");
  if (!available) return;
  Session = (await import(`${LIB}/models/Session.js`)).default;
  Project = (await import(`${LIB}/models/Project.js`)).default;
  Event = (await import(`${LIB}/models/Event.js`)).default;
  Fixation = (await import(`${LIB}/models/Fixation.js`)).default;
  ({ sweepIdleSessions } = await import(`${LIB}/sessions/sweepIdleSessions.js`));
  ({ finalizeSessionAndRollup } = await import(`${LIB}/sessions/finalizeSession.js`));
  ({ claimForFinalize } = await import(`${LIB}/sessions/claimSession.js`));
});

after(dropTestDb);

beforeEach(async () => {
  if (!available) return;
  await Promise.all([
    Session.deleteMany({}),
    Project.deleteMany({}),
    Event.deleteMany({}),
    Fixation.deleteMany({}),
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

async function seedProject() {
  const project = await Project.create({
    client_id: objectId(),
    name: "Test",
    domain: "example.test",
    pages: [{ path: "/p", slug: "p", status: "active", target: true }],
  });
  return project;
}

/**
 * A session with gaze events old enough to be swept, and enough samples on one
 * spot to yield fixations.
 */
async function seedSession(project, { minutesAgo = 60, sampleCount = 20, overrides = {} } = {}) {
  const startedAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  const sessionId = `sess_${Math.random().toString(36).slice(2, 12)}`;

  const session = await Session.create({
    session_id: sessionId,
    consumer_id: objectId(),
    project_id: project._id,
    status: "active",
    started_at: startedAt,
    last_activity_at: startedAt,
    pages_visited: [{ path: "/p", template: "/p", entered_at: startedAt }],
    entry_template: "/p",
    ...overrides,
  });

  const events = [];
  for (let i = 0; i < sampleCount; i++) {
    events.push({
      timestamp: new Date(startedAt.getTime() + i * 100),
      session_id: sessionId,
      type: "gaze",
      page_url: "/p",
      page_template: "/p",
      data: { viewport_x: 200, viewport_y: 300, scroll_x: 0, scroll_y: 0, element_id: "#hero" },
      metadata: { project_id: project._id, consumer_id: session.consumer_id },
    });
  }
  await Event.insertMany(events);
  return session;
}

test("an interrupted finalize leaves the session active and re-sweepable", async (t) => {
  if (skipUnlessMongo(t)) return;
  const project = await seedProject();
  const session = await seedSession(project);

  // Stand in for a process killed mid-finalize: the claim succeeds, the work
  // does not. Previously the claim itself had already written "completed".
  const claimed = await claimForFinalize({ session_id: session.session_id });
  assert.ok(claimed, "the lease should be free");

  const after = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(after.status, "active", "claiming must not complete the session");
  assert.ok(after.finalize_lease_until, "the lease should be held");

  // Lease expires (the holder died), so a later sweep picks it up and finishes.
  await Session.updateOne(
    { session_id: session.session_id },
    { $set: { finalize_lease_until: new Date(Date.now() - 1000) } }
  );

  const result = await sweepIdleSessions({ idleMs: 30 * 60 * 1000, limit: 10 });
  assert.equal(result.finalized, 1, "the abandoned session should be retried");

  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed");
  assert.ok(done.summary.total_fixations > 0, "fixations should exist after the retry");
  assert.equal(
    await Fixation.countDocuments({ session_id: session.session_id }),
    done.summary.total_fixations
  );
});

test("a held lease stops a second sweeper taking the same session", async (t) => {
  if (skipUnlessMongo(t)) return;
  const project = await seedProject();
  const session = await seedSession(project);

  const first = await claimForFinalize({ session_id: session.session_id });
  const second = await claimForFinalize({ session_id: session.session_id });
  assert.ok(first, "first claim wins");
  assert.equal(second, null, "second claim is refused while the lease is held");
});

test("two concurrent sweeps finalize a session exactly once", async (t) => {
  if (skipUnlessMongo(t)) return;
  const project = await seedProject();
  const session = await seedSession(project);

  const [a, b] = await Promise.all([
    sweepIdleSessions({ idleMs: 30 * 60 * 1000, limit: 10 }),
    sweepIdleSessions({ idleMs: 30 * 60 * 1000, limit: 10 }),
  ]);
  assert.equal(a.finalized + b.finalized, 1, "only one sweep should do the work");

  const fixationCount = await Fixation.countDocuments({ session_id: session.session_id });
  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(fixationCount, done.summary.total_fixations, "no duplicate fixations");

  const rolled = await Project.findById(project._id).lean();
  assert.equal(rolled.pages[0].session_count, 1, "session_count must not be double-counted");
});

test("finalizing twice derives one set of fixations and rolls up once", async (t) => {
  if (skipUnlessMongo(t)) return;
  const project = await seedProject();
  const session = await seedSession(project);

  const first = await claimForFinalize({ session_id: session.session_id });
  const endedAt = new Date();
  const r1 = await finalizeSessionAndRollup(first, endedAt);
  assert.ok(r1.fixation_count > 0);

  // Force a second run over the same session, as a retry after a partial
  // failure would. Derivation deletes before inserting, and the rollup is
  // guarded by rolled_up_at.
  const again = await Session.findOne({ session_id: session.session_id });
  again.status = "active";
  await again.save();
  const r2 = await finalizeSessionAndRollup(again, endedAt);

  assert.equal(r2.fixation_count, r1.fixation_count, "same fixations, not twice as many");
  assert.equal(
    await Fixation.countDocuments({ session_id: session.session_id }),
    r1.fixation_count,
    "the collection must not hold two copies"
  );

  const rolled = await Project.findById(project._id).lean();
  assert.equal(rolled.pages[0].session_count, 1, "the rollup must happen at most once");
});

test("a stationary-gaze session finalizes instead of hanging", async (t) => {
  if (skipUnlessMongo(t)) return;
  // 70k samples that never move: one unbounded window under the old clusterer,
  // which took over a minute of fully-blocked event loop to get through.
  const project = await seedProject();
  const session = await seedSession(project, { sampleCount: 0, minutesAgo: 180 });

  const startedAt = new Date(Date.now() - 180 * 60 * 1000);
  const batch = [];
  for (let i = 0; i < 70_000; i++) {
    batch.push({
      timestamp: new Date(startedAt.getTime() + i * 100),
      session_id: session.session_id,
      type: "gaze",
      page_url: "/p",
      page_template: "/p",
      data: { viewport_x: 500, viewport_y: 400, scroll_x: 0, scroll_y: 0 },
      metadata: { project_id: project._id, consumer_id: session.consumer_id },
    });
  }
  for (let i = 0; i < batch.length; i += 10_000) {
    await Event.insertMany(batch.slice(i, i + 10_000));
  }

  const began = Date.now();
  const result = await sweepIdleSessions({ idleMs: 30 * 60 * 1000, limit: 1 });
  const elapsed = Date.now() - began;

  assert.equal(result.finalized, 1);
  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed");
  // 70k samples at 10fps spans ~117 minutes; the 30s cap must break it up.
  assert.ok(
    done.summary.total_fixations >= 200,
    `expected the stare to be split into many fixations, got ${done.summary.total_fixations}`
  );
  assert.ok(elapsed < 30_000, `finalize took ${elapsed}ms`);
});

test("a session out of attempts is completed rather than retried forever", async (t) => {
  if (skipUnlessMongo(t)) return;
  const project = await seedProject();
  // No gaze events at all, and already at the attempt ceiling.
  const session = await seedSession(project, {
    sampleCount: 0,
    overrides: { finalize_attempts: 5 },
  });

  const result = await sweepIdleSessions({ idleMs: 30 * 60 * 1000, limit: 10 });
  assert.equal(result.finalized, 1);

  const done = await Session.findOne({ session_id: session.session_id }).lean();
  assert.equal(done.status, "completed", "it must stop cycling");
  assert.equal(done.summary.total_fixations, 0);
});
