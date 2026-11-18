// Regression: scroll_gaze_correlation was permanently 0 for every tag session.
//
// computeSessionEngagement projected `data.y` and read `Number(e.data?.y)`, but
// the tag writes gaze coordinates as viewport_y + scroll_y and never sets `y`
// at all. Number.isFinite was therefore false for every sample, gazeSamples
// came out empty, and 20% of the engagement weight was dead — the same bug
// c791be3 fixed in fixation derivation, in the one place it was missed.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, dropTestDb } from "./helpers/db.mjs";

const LIB = "../../Web-App/lessmissed/lib";

let Session, Project, Event, Fixation, computeSessionEngagement, deriveFixations;
let available = false;

before(async () => {
  available = await connectTestDb("engagementgaze");
  if (!available) return;
  Session = (await import(`${LIB}/models/Session.js`)).default;
  Project = (await import(`${LIB}/models/Project.js`)).default;
  Event = (await import(`${LIB}/models/Event.js`)).default;
  Fixation = (await import(`${LIB}/models/Fixation.js`)).default;
  ({ computeSessionEngagement } = await import(`${LIB}/insights/engagement.js`));
  ({ deriveFixations } = await import(`${LIB}/deriveFixations.js`));
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

/**
 * Gaze that tracks the scroll position, exactly as the tag records it: a
 * viewport coordinate plus the scroll offset at sample time, and no `y`.
 */
async function seedTagSession(projectId, consumerId) {
  const sessionId = `sess_${Math.random().toString(36).slice(2, 12)}`;
  const startedAt = new Date(Date.now() - 10 * 60 * 1000);

  const events = [];
  for (let i = 0; i < 120; i++) {
    const scrollY = i * 20;                   // scrolling steadily down
    const viewportY = 300 + (i % 5) * 4;      // reading near the same band
    events.push({
      timestamp: new Date(startedAt.getTime() + i * 100),
      session_id: sessionId,
      type: "gaze",
      page_url: "/p",
      page_template: "/p",
      // Note: viewport_y / scroll_y, never `y`.
      data: {
        viewport_x: 400 + (i % 7) * 3,
        viewport_y: viewportY,
        scroll_x: 0,
        scroll_y: scrollY,
        element_id: `#row-${i % 9}`,
        element_key: `div>ul>li:nth-of-type(${i % 9})`,
      },
      metadata: { project_id: projectId, consumer_id: consumerId },
    });
  }
  await Event.insertMany(events);
  await deriveFixations(sessionId, projectId.toString());
  return sessionId;
}

test("a tag-shaped gaze stream yields a non-zero scroll-gaze correlation", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await Project.create({
    client_id: objectId(), name: "Test", domain: "example.test",
    pages: [{ path: "/p", slug: "p", target: true }],
  });
  const consumerId = objectId();
  const sessionId = await seedTagSession(project._id, consumerId);

  const { score, breakdown } = await computeSessionEngagement(
    sessionId,
    project._id.toString()
  );

  assert.ok(
    breakdown.scroll_gaze_correlation > 0,
    "gaze that follows the scroll must score above zero; reading data.y made this always 0"
  );
  assert.ok(score > 0, "the session should score something");
});

test("pre-read gaze events give the same answer as reading them again", async (t) => {
  if (skipUnlessMongo(t)) return;
  // Finalize hands the gaze stream it already read straight to the scorer,
  // instead of issuing the same query a second time.
  const project = await Project.create({
    client_id: objectId(), name: "Test", domain: "example.test",
    pages: [{ path: "/p", slug: "p", target: true }],
  });
  const consumerId = objectId();
  const sessionId = await seedTagSession(project._id, consumerId);

  const { loadGazeEvents } = await import(`${LIB}/deriveFixations.js`);
  const gazeEvents = await loadGazeEvents(sessionId);

  const selfRead = await computeSessionEngagement(sessionId, project._id.toString());
  const passedIn = await computeSessionEngagement(sessionId, project._id.toString(), {
    gazeEvents,
  });

  assert.deepEqual(passedIn.breakdown, selfRead.breakdown);
  assert.equal(passedIn.score, selfRead.score);
});

test("legacy extension data using x/y still scores", async (t) => {
  if (skipUnlessMongo(t)) return;
  // The old extension stream wrote x/y rather than viewport_x/_y. absY falls
  // back to it, so historical sessions must not regress.
  const project = await Project.create({
    client_id: objectId(), name: "Test", domain: "example.test",
    pages: [{ path: "/p", slug: "p", target: true }],
  });
  const sessionId = `sess_${Math.random().toString(36).slice(2, 12)}`;
  const startedAt = new Date(Date.now() - 10 * 60 * 1000);

  const events = [];
  for (let i = 0; i < 120; i++) {
    events.push({
      timestamp: new Date(startedAt.getTime() + i * 100),
      session_id: sessionId, type: "gaze", page_url: "/p", page_template: "/p",
      data: { x: 400 + (i % 7) * 3, y: 300 + (i % 5) * 4, scroll_x: 0, scroll_y: i * 20,
              element_id: `#row-${i % 9}`, element_key: `k-${i % 9}` },
      metadata: { project_id: project._id, consumer_id: objectId() },
    });
  }
  await Event.insertMany(events);
  await deriveFixations(sessionId, project._id.toString());

  const { breakdown } = await computeSessionEngagement(sessionId, project._id.toString());
  assert.ok(breakdown.scroll_gaze_correlation > 0, "x/y data must keep working");
});
