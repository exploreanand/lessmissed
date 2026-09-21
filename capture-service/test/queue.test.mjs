// Queue semantics, tested against a real MongoDB.
//
// These are the properties that make "a crash cannot lose work" true. They
// cannot be verified by reading the code — the one that matters most, that two
// workers polling simultaneously never both win the same job, is a race, and a
// race either reproduces under contention or is asserted into existence.
//
// Run against a throwaway local mongod:
//   mongod --dbpath /tmp/x --port 27918
//   CAPTURE_TEST_MONGO_URI=mongodb://127.0.0.1:27918/lm_queue_test npm test
//
// Never point this at MONGODB_URI from .env.local — that is production data.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, dropTestDb } from "./helpers/db.mjs";

let CaptureJob;
let queue;
let available = false;

before(async () => {
  available = await connectTestDb("queue");
  if (!available) return;
  CaptureJob = (await import("../../Web-App/lessmissed/lib/models/CaptureJob.js")).default;
  queue = await import("../src/queue.js");
  await CaptureJob.syncIndexes();
});

after(dropTestDb);

beforeEach(async () => {
  if (available) await CaptureJob.deleteMany({});
});

const skipUnlessMongo = (t) => {
  if (!available) {
    t.skip("set CAPTURE_TEST_MONGO_URI to a local mongod to run queue tests");
    return true;
  }
  return false;
};

const ids = () => ({
  projectId: new mongoose.Types.ObjectId(),
  pageId: new mongoose.Types.ObjectId(),
});

test("a job is leased by exactly one worker under contention", async (t) => {
  if (skipUnlessMongo(t)) return;

  // 20 jobs, 40 workers all polling at once. If the status transition and the
  // selection were not one atomic operation, some job would be leased twice and
  // two workers would render and store the same page.
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    const { projectId, pageId } = ids();
    jobs.push({
      project_id: projectId,
      page_id: pageId,
      reason: "baseline",
      priority: 20,
      run_after: new Date(),
    });
  }
  await CaptureJob.insertMany(jobs);

  const leases = await Promise.all(
    Array.from({ length: 40 }, (_, i) => queue.leaseJob(`worker-${i}`))
  );

  const won = leases.filter(Boolean);
  const distinct = new Set(won.map((job) => String(job._id)));

  assert.equal(won.length, 20, "every job should be claimed exactly once");
  assert.equal(distinct.size, 20, "no job may be claimed twice");
  assert.equal(
    await CaptureJob.countDocuments({ status: "queued" }),
    0,
    "nothing should be left queued"
  );
});

test("priority decides order, and attempts increment on lease", async (t) => {
  if (skipUnlessMongo(t)) return;

  const mk = async (reason, priority) => {
    const { projectId, pageId } = ids();
    return CaptureJob.create({
      project_id: projectId,
      page_id: pageId,
      reason,
      priority,
      run_after: new Date(),
    });
  };

  await mk("scheduled", 0);
  await mk("manual", 30);
  await mk("drift", 10);

  const first = await queue.leaseJob("w1");
  const second = await queue.leaseJob("w1");
  const third = await queue.leaseJob("w1");

  assert.equal(first.reason, "manual", "a waiting admin goes first");
  assert.equal(second.reason, "drift");
  assert.equal(third.reason, "scheduled");
  assert.equal(first.attempts, 1, "leasing counts as an attempt");
});

test("a job not yet due is not leased", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();
  await CaptureJob.create({
    project_id: projectId,
    page_id: pageId,
    reason: "drift",
    run_after: new Date(Date.now() + 60_000),
  });

  assert.equal(await queue.leaseJob("w1"), null, "backoff must be respected");
});

test("heartbeat only works for the worker that holds the lease", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();
  await CaptureJob.create({ project_id: projectId, page_id: pageId, reason: "baseline" });

  const job = await queue.leaseJob("worker-a");
  assert.equal(await queue.heartbeat(job._id, "worker-a"), true);

  // A worker whose lease was reaped must not be able to take it back by
  // heartbeating — otherwise two workers would write captures for one page.
  assert.equal(
    await queue.heartbeat(job._id, "worker-b"),
    false,
    "a stranger must not extend someone else's lease"
  );

  const before = await CaptureJob.findById(job._id).lean();
  await queue.heartbeat(job._id, "worker-a");
  const after = await CaptureJob.findById(job._id).lean();
  assert.ok(
    after.lease_expires_at >= before.lease_expires_at,
    "heartbeat should push the expiry out"
  );
});

test("the reaper returns work abandoned by a dead worker", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();
  await CaptureJob.create({ project_id: projectId, page_id: pageId, reason: "baseline" });

  const job = await queue.leaseJob("doomed-worker");
  assert.equal(await queue.reapExpired(), 0, "a live lease must not be reaped");

  // Simulate the worker dying: the lease lapses with nobody to renew it.
  await CaptureJob.updateOne(
    { _id: job._id },
    { $set: { lease_expires_at: new Date(Date.now() - 1000) } }
  );

  assert.equal(await queue.reapExpired(), 1, "the lapsed lease should be reclaimed");

  const reclaimed = await queue.leaseJob("fresh-worker");
  assert.equal(String(reclaimed._id), String(job._id), "the same job comes back");
  assert.equal(reclaimed.attempts, 2, "and its attempt count carries over");
});

test("failure retries with backoff, then gives up as dead", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();
  await CaptureJob.create({
    project_id: projectId,
    page_id: pageId,
    reason: "baseline",
    max_attempts: 3,
  });

  let job = await queue.leaseJob("w1");
  let outcome = await queue.failJob(job._id, new Error("nav timeout"), "w1");
  assert.equal(outcome.retrying, true, "attempt 1 of 3 should retry");

  let stored = await CaptureJob.findById(job._id).lean();
  assert.equal(stored.status, "queued");
  assert.ok(stored.run_after > new Date(), "retry must be delayed, not immediate");
  assert.match(stored.last_error, /nav timeout/);

  // Make it due again, twice more, to exhaust the attempts.
  for (let i = 0; i < 2; i++) {
    await CaptureJob.updateOne({ _id: job._id }, { $set: { run_after: new Date() } });
    job = await queue.leaseJob("w1");
    outcome = await queue.failJob(job._id, new Error("nav timeout"), "w1");
  }

  assert.equal(outcome.dead, true, "a job that keeps failing must stop retrying");
  stored = await CaptureJob.findById(job._id).lean();
  assert.equal(stored.status, "dead");
  assert.equal(
    await queue.leaseJob("w1"),
    null,
    "a dead job is never leased again"
  );
});

test("completeJob records what the job produced", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();
  await CaptureJob.create({ project_id: projectId, page_id: pageId, reason: "manual" });

  const job = await queue.leaseJob("w1");
  const captureId = new mongoose.Types.ObjectId();
  await queue.completeJob(job._id, captureId, "w1");

  const stored = await CaptureJob.findById(job._id).lean();
  assert.equal(stored.status, "succeeded");
  assert.equal(String(stored.capture_id), String(captureId));
  assert.equal(stored.lease_expires_at, null);
});

test("enqueue deduplicates, and a manual request promotes a queued job", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();

  const first = await queue.enqueue({ projectId, pageId, reason: "drift" });
  assert.equal(first.created, true);

  // A nightly sweep and an impatient admin can both decide the same page needs
  // work within seconds; rendering it twice is pure waste.
  const second = await queue.enqueue({ projectId, pageId, reason: "drift" });
  assert.equal(second.created, false, "a second identical request must not queue again");
  assert.equal(await CaptureJob.countDocuments({ page_id: pageId }), 1);

  const manual = await queue.enqueue({ projectId, pageId, reason: "manual" });
  assert.equal(manual.created, false, "still no second job");

  const stored = await CaptureJob.findOne({ page_id: pageId }).lean();
  assert.equal(stored.priority, 30, "but the waiting admin jumps the queue");
  assert.equal(stored.reason, "manual");
});

test("enqueue treats breakpoints as separate work", async (t) => {
  if (skipUnlessMongo(t)) return;

  const { projectId, pageId } = ids();
  await queue.enqueue({ projectId, pageId, breakpoint: "desktop", reason: "baseline" });
  await queue.enqueue({ projectId, pageId, breakpoint: "mobile", reason: "baseline" });

  assert.equal(
    await CaptureJob.countDocuments({ page_id: pageId }),
    2,
    "desktop and mobile are different renders of the same page"
  );
});
