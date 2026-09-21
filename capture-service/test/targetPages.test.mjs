// "Admin adds a target page" — the flow end to end, minus the HTTP wrapper.
//
// This exercises the same functions POST /api/projects/:id/pages calls, against
// a real database: URL validation, template normalisation, slug allocation,
// promotion of a discovered page, and baseline enqueue. The route itself adds
// only authentication and error-to-status mapping.
//
//   mongod --dbpath /tmp/x --port 27918
//   CAPTURE_TEST_MONGO_URI=mongodb://127.0.0.1:27918/lm_queue_test npm test

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, dropTestDb } from "./helpers/db.mjs";

const LIB = "../../Web-App/lessmissed/lib";

let Project;
let CaptureJob;
let targetPages;
let available = false;

before(async () => {
  available = await connectTestDb("targetpages");
  if (!available) return;
  Project = (await import(`${LIB}/models/Project.js`)).default;
  CaptureJob = (await import(`${LIB}/models/CaptureJob.js`)).default;
  targetPages = await import(`${LIB}/capture/targetPages.js`);
});

after(dropTestDb);

beforeEach(async () => {
  if (available) await Promise.all([Project.deleteMany({}), CaptureJob.deleteMany({})]);
});

const skipUnlessMongo = (t) => {
  if (!available) {
    t.skip("set CAPTURE_TEST_MONGO_URI to a local mongod to run these");
    return true;
  }
  return false;
};

async function makeProject(pages = []) {
  return Project.create({
    client_id: new mongoose.Types.ObjectId(),
    name: "Test Project",
    domain: "example.com",
    pages,
  });
}

test("adding a page registers it and queues a baseline", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  const { page, queued, created } = await targetPages.addTargetPage({
    project: project.toObject(),
    url: "https://example.com/pricing",
  });

  assert.equal(created, true);
  assert.equal(page.path, "/pricing");
  assert.equal(page.slug, "pricing");
  assert.equal(page.target, true, "an explicitly added page is a target");
  assert.equal(page.approval_status, "approved");
  assert.equal(page.capture_url, "https://example.com/pricing");
  assert.equal(page.screenshot_status, "queued");

  const stored = await Project.findById(project._id).lean();
  assert.equal(stored.pages.length, 1, "the page is persisted");

  assert.deepEqual(queued, [{ breakpoint: "desktop", created: true }]);
  const jobs = await CaptureJob.find({ page_id: page._id }).lean();
  assert.equal(jobs.length, 1, "exactly one baseline job");
  assert.equal(jobs[0].reason, "baseline");
  assert.equal(jobs[0].priority, 20, "baselines outrank scheduled sweeps");
});

test("a pasted browser URL works, and so does a bare path", async (t) => {
  if (skipUnlessMongo(t)) return;

  // The old setup wizard dropped any line not starting with "/", so pasting the
  // URL out of the browser bar silently added nothing at all.
  for (const [input, expectedPath] of [
    ["https://example.com/pricing?utm_source=x#top", "/pricing"],
    ["/features", "/features"],
    ["example.com/contact", "/contact"],
    ["https://www.example.com/team", "/team"],
  ]) {
    const project = await makeProject();
    const { page } = await targetPages.addTargetPage({
      project: project.toObject(),
      url: input,
    });
    assert.equal(page.path, expectedPath, `"${input}" should become ${expectedPath}`);
    await Project.deleteMany({});
  }
});

test("a product URL collapses to its template and keeps the real URL to capture", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  const { page } = await targetPages.addTargetPage({
    project: project.toObject(),
    url: "https://example.com/products/8812",
  });

  // "/products/:id" is the unit a brand reasons about, but it is not navigable
  // — so the concrete URL the admin gave is what actually gets rendered.
  assert.equal(page.path, "/products/:id");
  assert.equal(page.slug, "products-id");
  assert.equal(page.type, "wildcard");
  assert.equal(page.capture_url, "https://example.com/products/8812");
});

test("adding a discovered page promotes it instead of duplicating it", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject([
    {
      path: "/about",
      slug: "about",
      discovered: true,
      approval_status: "pending",
      session_count: 42,
      sample_urls: ["https://example.com/about"],
    },
  ]);

  const { page, created } = await targetPages.addTargetPage({
    project: project.toObject(),
    url: "https://example.com/about",
  });

  assert.equal(created, false, "it already existed");
  assert.equal(page.target, true, "now it is a target");
  assert.equal(page.approval_status, "approved");

  const stored = await Project.findById(project._id).lean();
  assert.equal(stored.pages.length, 1, "no duplicate row — gaze data stays in one place");
  assert.equal(stored.pages[0].session_count, 42, "existing data is preserved");
  assert.equal(stored.pages[0].target, true);
});

test("a URL on someone else's domain is refused", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  await assert.rejects(
    () => targetPages.addTargetPage({ project: project.toObject(), url: "https://evil.com/x" }),
    (err) => {
      assert.equal(err.name, "TargetPageError");
      assert.match(err.message, /not on example\.com/);
      return true;
    },
    "the worker must not be usable as a general screenshot proxy"
  );

  assert.equal(await CaptureJob.countDocuments({}), 0, "nothing queued");
});

test("internal addresses are refused", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await Project.create({
    client_id: new mongoose.Types.ObjectId(),
    name: "Localhost Project",
    domain: "localhost",
    pages: [],
  });

  await assert.rejects(
    () => targetPages.addTargetPage({ project: project.toObject(), url: "http://localhost:3000/admin" }),
    (err) => {
      assert.match(err.message, /private or internal/);
      return true;
    }
  );
});

test("an empty or unparseable URL is rejected before anything is written", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  for (const bad of ["", "   ", "http://"]) {
    await assert.rejects(
      () => targetPages.addTargetPage({ project: project.toObject(), url: bad }),
      (err) => err.name === "TargetPageError"
    );
  }

  const stored = await Project.findById(project._id).lean();
  assert.equal(stored.pages.length, 0, "no half-created page");
});

test("adding the same page twice does not queue a second render", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  await targetPages.addTargetPage({ project: project.toObject(), url: "https://example.com/pricing" });

  const reloaded = await Project.findById(project._id).lean();
  await targetPages.addTargetPage({ project: reloaded, url: "https://example.com/pricing" });

  const final = await Project.findById(project._id).lean();
  assert.equal(final.pages.length, 1, "still one page");
  assert.equal(await CaptureJob.countDocuments({}), 1, "still one job");
});

test("slug collisions are resolved, including the reserved -header suffix", async (t) => {
  if (skipUnlessMongo(t)) return;

  const pages = [{ path: "/a", slug: "pricing" }];
  assert.equal(targetPages.uniqueSlug("pricing", pages), "pricing-2");
  assert.equal(targetPages.uniqueSlug("checkout", pages), "checkout");
  // The legacy path writes "<slug>-header.jpg" for a page's sticky nav, so a
  // page that slugs to "foo-header" would collide with page "foo"'s header.
  assert.equal(targetPages.uniqueSlug("foo-header", pages), "foo-header-2");
});

test("selectors are sanitised before they reach a browser", async (t) => {
  if (skipUnlessMongo(t)) return;

  const messy = ["  .ad  ", "", 42, null, "#ok", "x".repeat(500)];
  assert.deepEqual(targetPages.sanitiseSelectors(messy), [".ad", "#ok"]);
  assert.deepEqual(targetPages.sanitiseSelectors("not an array"), []);
  assert.equal(targetPages.sanitiseSelectors(new Array(80).fill(".x")).length, 50, "capped");
});

test("requesting both breakpoints queues two independent renders", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  const { page, queued } = await targetPages.addTargetPage({
    project: project.toObject(),
    url: "https://example.com/",
    breakpoints: ["desktop", "mobile"],
  });

  assert.equal(page.slug, "home", "the root path slugs to 'home'");
  assert.equal(queued.length, 2);
  assert.equal(await CaptureJob.countDocuments({ page_id: page._id }), 2);
});

test("an unknown breakpoint is rejected", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  await assert.rejects(
    () =>
      targetPages.addTargetPage({
        project: project.toObject(),
        url: "https://example.com/",
        breakpoints: ["watch"],
      }),
    (err) => /Unknown breakpoint/.test(err.message)
  );
});

// The setup-wizard path: a project created with several target URLs at once.
//
// Regression for the reported bug — a page entered during first-time setup was
// never captured. The wizard hand-built page subdocuments and posted them inside
// the project body, so they carried no `target` flag, no `capture_url` and no
// CaptureJob; the page only started working once the admin re-added it from the
// dashboard, which promoted the existing row. These assert that creating a
// project registers real target pages and queues a baseline for each.

test("creating a project with target URLs queues a baseline for every one", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  const urls = [
    "https://example.com/",
    "https://example.com/pricing",
    "/features",
  ];

  for (const url of urls) {
    const current = await Project.findById(project._id).lean();
    await targetPages.addTargetPage({ project: current, url });
  }

  const stored = await Project.findById(project._id).lean();
  assert.equal(stored.pages.length, 3, "one page per URL");

  for (const page of stored.pages) {
    assert.equal(page.target, true, `${page.path} must be a target page`);
    assert.ok(page.capture_url, `${page.path} must carry a URL to render`);
    assert.equal(page.screenshot_status, "queued");
  }

  const jobs = await CaptureJob.find({}).lean();
  assert.equal(jobs.length, 3, "a baseline job per page");
  assert.ok(jobs.every((j) => j.reason === "baseline" && j.status === "queued"));

  // Slugs must be distinct, or two pages share one screenshot and one heatmap.
  const slugs = new Set(stored.pages.map((p) => p.slug));
  assert.equal(slugs.size, 3, "slugs must not collide");
});

test("one bad URL does not cost the admin the other pages", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await makeProject();
  const urls = [
    "https://example.com/pricing",
    "https://evil.com/phishing", // wrong domain
    "https://example.com/contact",
  ];

  const results = [];
  for (const url of urls) {
    const current = await Project.findById(project._id).lean();
    try {
      await targetPages.addTargetPage({ project: current, url });
      results.push({ url, ok: true });
    } catch (err) {
      results.push({ url, ok: false, error: err.message });
    }
  }

  assert.deepEqual(
    results.map((r) => r.ok),
    [true, false, true],
    "the valid pages survive a bad one in the middle"
  );

  const stored = await Project.findById(project._id).lean();
  assert.equal(stored.pages.length, 2);
  assert.equal(await CaptureJob.countDocuments({}), 2);
  assert.match(results[1].error, /not on example\.com/);
});
