// Page identity on the finalize path.
//
// Regression for a bug that made every page in every project read "0 sessions"
// and left discovered pages stuck at "awaiting data" forever: finalize replaced
// the session's journey with the extension's copy, which carries only path,
// entered_at and left_at. Every `pages_visited[].template` in the live database
// was null as a result, and the rollup — which filters on Boolean(template) —
// silently did nothing.
//
// These exercise the resolution rule directly: the template must come from the
// server, matching what /api/extension/visits computes, and a payload with no
// templates at all must still produce correct ones.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, dropTestDb } from "./helpers/db.mjs";

const LIB = "../../Web-App/lessmissed/lib";

let Project;
let pathTemplate;
let available = false;

before(async () => {
  available = await connectTestDb("visittemplates");
  if (!available) return;
  Project = (await import(`${LIB}/models/Project.js`)).default;
  pathTemplate = await import(`${LIB}/pathTemplate.js`);
});

after(dropTestDb);

beforeEach(async () => {
  if (available) await Project.deleteMany({});
});

const skipUnlessMongo = (t) => {
  if (!available) {
    t.skip("set CAPTURE_TEST_MONGO_URI to a local mongod to run these");
    return true;
  }
  return false;
};

/**
 * The rule the finalize route applies, mirrored here so the test pins the
 * behaviour rather than the implementation: prefer the configured page's own
 * path, fall back to the computed template.
 */
function resolveVisitTemplate(pages, rawPath) {
  return pathTemplate.findMatchingPage(pages, rawPath)?.path ?? pathTemplate.normalizePath(rawPath);
}

/** What the rollup at the end of finalize actually iterates. */
function rollupTemplates(visits) {
  return [...new Set(visits.map((v) => v.template).filter(Boolean))];
}

test("a payload with no templates still resolves every visit", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await Project.create({
    client_id: new mongoose.Types.ObjectId(),
    name: "Suvria",
    domain: "www.suvria.com",
    pages: [
      { path: "/", slug: "home", target: true },
      { path: "/products", slug: "products", discovered: true, status: "awaiting_data" },
      { path: "/about", slug: "about", discovered: true, status: "awaiting_data" },
    ],
  });
  const pages = project.toObject().pages;

  // Exactly what background.ts sends: path, entered_at, left_at. No template.
  const fromExtension = [
    { path: "/", entered_at: "2026-09-20T10:00:00Z", left_at: "2026-09-20T10:01:00Z" },
    { path: "/products", entered_at: "2026-09-20T10:01:00Z", left_at: "2026-09-20T10:02:00Z" },
    { path: "/about", entered_at: "2026-09-20T10:02:00Z", left_at: null },
  ];

  const resolved = fromExtension.map((v) => ({
    ...v,
    template: v.template ?? resolveVisitTemplate(pages, v.path),
  }));

  assert.deepEqual(
    resolved.map((v) => v.template),
    ["/", "/products", "/about"],
    "no template may be null"
  );

  // The rollup is what increments session_count and flips awaiting_data.
  assert.deepEqual(rollupTemplates(resolved).sort(), ["/", "/about", "/products"]);
});

test("the old behaviour is what broke it — nulls roll up to nothing", async (t) => {
  if (skipUnlessMongo(t)) return;

  const asStored = [
    { path: "/", template: null },
    { path: "/products", template: null },
  ];
  assert.deepEqual(
    rollupTemplates(asStored),
    [],
    "filter(Boolean) drops every visit, so no page is ever updated"
  );
});

test("a configured wildcard keeps its own path, not the computed one", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await Project.create({
    client_id: new mongoose.Types.ObjectId(),
    name: "Blog",
    domain: "example.com",
    // The client typed "/blog/*"; normalizePath would compute "/blog/:id".
    pages: [{ path: "/blog/*", slug: "blog-all", type: "wildcard", target: true }],
  });
  const pages = project.toObject().pages;

  assert.equal(
    resolveVisitTemplate(pages, "/blog/my-first-post"),
    "/blog/*",
    "must match the page row that exists, or the visit is stranded"
  );
  assert.notEqual(pathTemplate.normalizePath("/blog/my-first-post"), "/blog/*");
});

test("a page nobody configured still gets its computed template", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await Project.create({
    client_id: new mongoose.Types.ObjectId(),
    name: "Shop",
    domain: "example.com",
    pages: [{ path: "/", slug: "home", target: true }],
  });
  const pages = project.toObject().pages;

  // Nothing matches, so the computed template stands — and it collapses the
  // product id, which is what keeps a 5000-product store to one page row.
  assert.equal(resolveVisitTemplate(pages, "/products/8812"), "/products/:id");
  assert.equal(resolveVisitTemplate(pages, "/contact"), "/contact");
});

test("the rollup flips a discovered page out of awaiting_data", async (t) => {
  if (skipUnlessMongo(t)) return;

  const project = await Project.create({
    client_id: new mongoose.Types.ObjectId(),
    name: "Suvria",
    domain: "www.suvria.com",
    pages: [
      { path: "/products", slug: "products", discovered: true, status: "awaiting_data" },
    ],
  });

  const templates = rollupTemplates([{ path: "/products", template: "/products" }]);
  assert.equal(templates.length, 1, "the visit must survive the Boolean filter");

  for (const template of templates) {
    await Project.updateOne(
      { _id: project._id, "pages.path": template },
      { $inc: { "pages.$.session_count": 1 }, $set: { "pages.$.last_session_at": new Date() } }
    );
    await Project.updateOne(
      { _id: project._id, pages: { $elemMatch: { path: template, status: "awaiting_data" } } },
      { $set: { "pages.$.status": "active" } }
    );
  }

  const stored = await Project.findById(project._id).lean();
  assert.equal(stored.pages[0].session_count, 1, "session_count must increment");
  assert.equal(stored.pages[0].status, "active", "the page must leave awaiting_data");
});
