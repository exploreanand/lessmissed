/**
 * LessMissed — MongoDB Seed Script
 *
 * Populates the database with realistic dummy data for development.
 * Run with:  node scripts/seed.js
 *
 * Requires MONGODB_URI in .env.local  OR  pass it as env var:
 *   MONGODB_URI=mongodb://localhost:27017/lessmissed node scripts/seed.js
 */

import mongoose from "mongoose";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// 1. Load env
// ---------------------------------------------------------------------------
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!process.env[key]) process.env[key] = rest.join("=");
    }
  } catch {
    // No .env.local; assume env vars are set externally
  }
}
loadEnv();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI not set. Add it to .env.local or pass as env var.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Inline schemas (mirrors lib/models — keeps seed self-contained)
// ---------------------------------------------------------------------------
const { Schema, model, models } = mongoose;

const userSchema = new Schema(
  {
    type: String,
    email: { type: String, unique: true },
    password_hash: String,
    name: String,
    plan: String,
    trust_score: Number,
    total_rewards_earned: Number,
    settings: Object,
  },
  { timestamps: { createdAt: "created_at" } }
);

const pageSubSchema = new Schema({
  path: String,
  slug: String,
  type: String,
  status: String,
  added_at: Date,
  session_count: Number,
  last_session_at: Date,
  avg_fixation_per_session: Number,
  missed_elements_pct: Number,
  health_score: Number,
});

const projectSchema = new Schema(
  {
    client_id: Schema.Types.ObjectId,
    name: String,
    domain: String,
    pages: [pageSubSchema],
    health_score: Number,
    total_sessions: Number,
    status: String,
  },
  { timestamps: { createdAt: "created_at" } }
);

const taskSchema = new Schema(
  {
    project_id: Schema.Types.ObjectId,
    client_id: Schema.Types.ObjectId,
    title: String,
    description: String,
    pages: [String],
    estimated_minutes: Number,
    coupon_id: Schema.Types.ObjectId,
    schedule: Object,
    status: String,
    stats: Object,
  },
  { timestamps: { createdAt: "created_at" } }
);

const sessionSchema = new Schema(
  {
    session_id: { type: String, unique: true },
    consumer_id: Schema.Types.ObjectId,
    task_id: Schema.Types.ObjectId,
    project_id: Schema.Types.ObjectId,
    status: String,
    pages_visited: Array,
    pages_required: [String],
    task_completed: Boolean,
    engagement_score: Number,
    engagement_breakdown: Object,
    data_accepted: Boolean,
    reward_given: Boolean,
    duration_ms: Number,
    active_time_ms: Number,
    started_at: Date,
    ended_at: Date,
    summary: Object,
  },
  { timestamps: { createdAt: "created_at" } }
);

// Events — plain collection (time series configured via createCollection below)
const eventSchema = new Schema(
  {
    timestamp: Date,
    session_id: String,
    type: String,
    page_url: String,
    data: Object,
    metadata: Object,
  },
  { collection: "events", _id: false, timestamps: false }
);

const fixationSchema = new Schema(
  {
    session_id: String,
    project_id: Schema.Types.ObjectId,
    page_url: String,
    element_id: String,
    element_xpath: String,
    center_x: Number,
    center_y: Number,
    duration_ms: Number,
    start_timestamp: Date,
    end_timestamp: Date,
    sample_count: Number,
  },
  { collection: "fixations", timestamps: false }
);

const couponSchema = new Schema(
  {
    client_id: Schema.Types.ObjectId,
    project_id: Schema.Types.ObjectId,
    type: String,
    value: Number,
    currency: String,
    description: String,
    code: String,
    rules: Object,
    stats: Object,
    status: String,
  },
  { timestamps: { createdAt: "created_at" } }
);

// Register models (guard against re-registration)
const User = models.SeedUser || model("SeedUser", userSchema, "users");
const Project = models.SeedProject || model("SeedProject", projectSchema, "projects");
const Task = models.SeedTask || model("SeedTask", taskSchema, "tasks");
const Session = models.SeedSession || model("SeedSession", sessionSchema, "sessions");
const Event = models.SeedEvent || model("SeedEvent", eventSchema, "events");
const Fixation = models.SeedFixation || model("SeedFixation", fixationSchema, "fixations");
const Coupon = models.SeedCoupon || model("SeedCoupon", couponSchema, "coupons");

// ---------------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------------
function rng(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function rngF(min, max, dp = 1) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function ago(days, jitterHours = 12) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - rng(0, jitterHours));
  return d;
}
function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// Realistic page elements per page type
const ELEMENTS = {
  "/": ["#hero-cta", "#nav-bar", "#hero-headline", "#featured-products", "#trust-bar", "#footer", "#hero-subheading", "#newsletter-form"],
  "/products/:id": ["#product-title", "#add-to-cart", "#price", "#product-images", "#reviews", "#description", "#related-products", "#size-selector"],
  "/checkout": ["#order-summary", "#delivery-form", "#pay-btn", "#promo-code", "#trust-badges", "#back-link", "#shipping-options"],
  "/cart": ["#cart-items", "#subtotal", "#checkout-btn", "#promo-field", "#continue-shopping", "#delivery-estimate"],
  "/search": ["#search-bar", "#filter-panel", "#results-grid", "#sort-dropdown", "#pagination", "#no-results"],
  "/collections/:id": ["#collection-hero", "#product-grid", "#filter-bar", "#breadcrumb", "#sort-by", "#load-more"],
  "/about": ["#mission-section", "#team-grid", "#story-text", "#cta-banner"],
  "/shop": ["#product-grid", "#filter-sidebar", "#hero-banner", "#new-arrivals", "#sort-control"],
  "/p/:id": ["#product-name", "#gallery", "#buy-btn", "#price-tag", "#size-chart", "#reviews", "#wishlist-btn"],
  "/bag": ["#bag-items", "#total-price", "#checkout-cta", "#coupon-input"],
};

function elementsForPath(path) {
  // Match wildcard-style paths
  for (const [pattern, els] of Object.entries(ELEMENTS)) {
    if (pattern === path) return els;
    const regStr = "^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$";
    if (new RegExp(regStr).test(path)) return els;
  }
  return ["#main-content", "#nav", "#footer", "#cta"];
}

// Generate realistic gaze fixation for an element
function makeFixation(sessionId, projectId, pageUrl, elementId, baseTime, order) {
  const x = rng(50, 1350);
  const y = rng(100, 2400);
  const durationMs = rng(180, 2200);
  const start = new Date(baseTime.getTime() + order * rng(800, 3000));
  const end = new Date(start.getTime() + durationMs);
  return {
    session_id: sessionId,
    project_id: projectId,
    page_url: pageUrl,
    element_id: elementId,
    element_xpath: `/html/body/div[1]${elementId.replace("#", "//")}`,
    center_x: x,
    center_y: y,
    duration_ms: durationMs,
    start_timestamp: start,
    end_timestamp: end,
    sample_count: Math.floor(durationMs / 16),
  };
}

// Generate a batch of raw events for a session on a page
function makeEvents(sessionId, projectId, consumerId, pageUrl, sessionStart) {
  const events = [];
  const ts = (offset) => new Date(sessionStart.getTime() + offset);
  const elements = elementsForPath(pageUrl);

  // Gaze events (sampled at ~30fps, ~10s on page)
  for (let i = 0; i < 300; i++) {
    const el = pick(elements);
    events.push({
      timestamp: ts(i * 33 + rng(-5, 5)),
      session_id: sessionId,
      type: "gaze",
      page_url: pageUrl,
      data: {
        viewport_x: rng(20, 1400),
        viewport_y: rng(20, 900),
        document_x: rng(20, 1400),
        document_y: rng(20, 2400),
        element_id: el,
        confidence: rngF(0.42, 0.97),
      },
      metadata: { project_id: projectId, consumer_id: consumerId },
    });
  }

  // Click events (2-8 clicks)
  const clickCount = rng(2, 8);
  for (let i = 0; i < clickCount; i++) {
    const el = pick(elements);
    events.push({
      timestamp: ts(rng(500, 9500)),
      session_id: sessionId,
      type: "click",
      page_url: pageUrl,
      data: {
        viewport_x: rng(20, 1400),
        viewport_y: rng(20, 900),
        element_id: el,
        element_tag: pick(["BUTTON", "A", "DIV", "SPAN"]),
        element_text: pick(["Buy Now", "Add to Cart", "Continue", "View", "Submit", ""]),
        is_interactive: Math.random() > 0.2,
        click_count: 1,
      },
      metadata: { project_id: projectId, consumer_id: consumerId },
    });
  }

  // Scroll events (sampled at 10fps, ~5s of scrolling)
  let scrollY = 0;
  for (let i = 0; i < 50; i++) {
    const dir = Math.random() > 0.85 ? "up" : "down";
    scrollY = Math.max(0, scrollY + (dir === "down" ? rng(20, 200) : -rng(10, 100)));
    events.push({
      timestamp: ts(i * 100 + rng(0, 20)),
      session_id: sessionId,
      type: "scroll",
      page_url: pageUrl,
      data: {
        scroll_y: scrollY,
        scroll_direction: dir,
        scroll_velocity: rng(50, 1200),
        viewport_height: 900,
        document_height: 3200,
        scroll_depth_percent: Math.min(100, ((scrollY + 900) / 3200) * 100),
      },
      metadata: { project_id: projectId, consumer_id: consumerId },
    });
  }

  // Hover events (10fps sample, 3s)
  for (let i = 0; i < 30; i++) {
    events.push({
      timestamp: ts(i * 100 + 2000),
      session_id: sessionId,
      type: "hover",
      page_url: pageUrl,
      data: {
        viewport_x: rng(20, 1400),
        viewport_y: rng(20, 900),
        element_id: pick(elements),
      },
      metadata: { project_id: projectId, consumer_id: consumerId },
    });
  }

  return events;
}

// Build fixations from session data (derived gaze clusters)
function makeFixations(sessionId, projectId, pages, sessionStart) {
  const fixations = [];
  pages.forEach((pagePath, pi) => {
    const elements = elementsForPath(pagePath);
    const pageStart = new Date(sessionStart.getTime() + pi * 45000);
    const numFixations = rng(8, 25);
    for (let i = 0; i < numFixations; i++) {
      fixations.push(
        makeFixation(sessionId, projectId, pagePath, pick(elements), pageStart, i)
      );
    }
  });
  return fixations;
}

// Compute engagement score breakdown
function computeEngagement() {
  const fixation_diversity = rng(30, 100);
  const saccade_naturalness = rng(40, 100);
  const scroll_gaze_correlation = rng(20, 100);
  const page_coverage = rng(25, 100);
  const interaction_signals = rng(10, 100);
  const score = Math.round(
    fixation_diversity * 0.3 +
      saccade_naturalness * 0.25 +
      scroll_gaze_correlation * 0.2 +
      page_coverage * 0.15 +
      interaction_signals * 0.1
  );
  return {
    score,
    breakdown: { fixation_diversity, saccade_naturalness, scroll_gaze_correlation, page_coverage, interaction_signals },
  };
}

// ---------------------------------------------------------------------------
// 4. Main seed function
// ---------------------------------------------------------------------------
async function seed() {
  console.log("Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log("Connected.\n");

  // ---- Create time series collection if it doesn't exist ----
  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: "events" }).toArray();
  if (collections.length === 0) {
    console.log("Creating events time series collection…");
    await db.createCollection("events", {
      timeseries: {
        timeField: "timestamp",
        metaField: "metadata",
        granularity: "seconds",
      },
      expireAfterSeconds: 7776000, // 90 days
    });
    console.log("events collection created.\n");
  } else {
    console.log("events collection already exists.\n");
  }

  // ---- Clear existing data ----
  console.log("Clearing existing seed data…");
  await Promise.all([
    User.deleteMany({}),
    Project.deleteMany({}),
    Task.deleteMany({}),
    Session.deleteMany({}),
    db.collection("events").deleteMany({}),
    db.collection("fixations").deleteMany({}),
    Coupon.deleteMany({}),
  ]);
  console.log("Cleared.\n");

  // ---- Users ----
  console.log("Creating users…");
  const clientUsers = await User.insertMany([
    { type: "client", email: "team@acme.com", name: "Acme UX Team", plan: "growth", settings: { notifications: true, email_digest: "weekly" } },
    { type: "client", email: "ux@novafashion.in", name: "Nova Fashion UX", plan: "starter", settings: { notifications: true, email_digest: "daily" } },
    { type: "client", email: "product@brewlab.io", name: "BrewLab Product", plan: "growth", settings: { notifications: false, email_digest: "weekly" } },
  ]);

  const consumerUsers = await User.insertMany(
    Array.from({ length: 30 }, (_, i) => ({
      type: "consumer",
      email: `user${i + 1}@example.com`,
      name: `Consumer ${i + 1}`,
      trust_score: rng(70, 100),
      total_rewards_earned: rng(0, 12),
      settings: { notifications: true, email_digest: "none" },
    }))
  );
  console.log(`Created ${clientUsers.length} clients, ${consumerUsers.length} consumers.\n`);

  // ---- Projects ----
  console.log("Creating projects…");
  const projectDefs = [
    {
      client_id: clientUsers[0]._id,
      name: "Acme Store",
      domain: "acme.com",
      status: "active",
      pages: [
        { path: "/", slug: "home", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/products/:id", slug: "pdp", type: "wildcard", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/checkout", slug: "checkout", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/cart", slug: "cart", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/search", slug: "search", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/collections/:id", slug: "category", type: "wildcard", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/about", slug: "about", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
      ],
    },
    {
      client_id: clientUsers[1]._id,
      name: "Nova Fashion",
      domain: "novafashion.in",
      status: "active",
      pages: [
        { path: "/", slug: "home", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/shop", slug: "shop", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/p/:id", slug: "product", type: "wildcard", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/bag", slug: "bag", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
      ],
    },
    {
      client_id: clientUsers[2]._id,
      name: "BrewLab",
      domain: "brewlab.io",
      status: "active",
      pages: [
        { path: "/", slug: "home", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/products/:id", slug: "product", type: "wildcard", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
        { path: "/checkout", slug: "checkout", type: "exact", status: "active", session_count: 0, health_score: 0, avg_fixation_per_session: 0, missed_elements_pct: 0 },
      ],
    },
  ];
  const projects = await Project.insertMany(projectDefs);
  console.log(`Created ${projects.length} projects.\n`);

  // ---- Coupons ----
  console.log("Creating coupons…");
  const coupons = await Coupon.insertMany([
    {
      client_id: clientUsers[0]._id, project_id: projects[0]._id,
      type: "percentage", value: 20, currency: "INR", code: "GAZE20",
      description: "20% off your first order",
      rules: { max_redemptions: 200, expiry_date: new Date("2026-06-30"), min_order_value: 500, one_per_user: true },
      stats: { total_earned: 87, total_redeemed: 47, total_expired: 3 },
      status: "active",
    },
    {
      client_id: clientUsers[0]._id, project_id: projects[0]._id,
      type: "free_delivery", value: null, currency: "INR", code: "FREESHIP",
      description: "Free delivery on any order",
      rules: { max_redemptions: 200, expiry_date: new Date("2026-03-31"), min_order_value: 0, one_per_user: true },
      stats: { total_earned: 200, total_redeemed: 200, total_expired: 0 },
      status: "redeemed_out",
    },
    {
      client_id: clientUsers[1]._id, project_id: projects[1]._id,
      type: "fixed", value: 100, currency: "INR", code: "NOVA100",
      description: "₹100 off orders above ₹999",
      rules: { max_redemptions: 50, expiry_date: new Date("2026-05-15"), min_order_value: 999, one_per_user: true },
      stats: { total_earned: 28, total_redeemed: 18, total_expired: 1 },
      status: "active",
    },
    {
      client_id: clientUsers[2]._id, project_id: projects[2]._id,
      type: "percentage", value: 15, currency: "INR", code: "BREW15",
      description: "15% off your first brew kit",
      rules: { max_redemptions: 100, expiry_date: new Date("2026-07-01"), min_order_value: 800, one_per_user: true },
      stats: { total_earned: 34, total_redeemed: 20, total_expired: 0 },
      status: "active",
    },
  ]);
  console.log(`Created ${coupons.length} coupons.\n`);

  // ---- Tasks ----
  console.log("Creating tasks…");
  const tasks = await Task.insertMany([
    {
      project_id: projects[0]._id, client_id: clientUsers[0]._id,
      title: "Explore summer collection",
      description: "Browse the homepage, summer collection, and one product page.",
      pages: ["/", "/collections/:id", "/products/:id"],
      estimated_minutes: 5, coupon_id: coupons[0]._id,
      schedule: { start_date: ago(30), end_date: new Date("2026-06-01"), daily_cap: 20, total_cap: 500 },
      status: "active",
      stats: { total_started: 342, total_completed: 298, total_rewarded: 298, avg_engagement_score: 74 },
    },
    {
      project_id: projects[0]._id, client_id: clientUsers[0]._id,
      title: "Checkout flow audit",
      description: "Visit the cart and complete the checkout flow.",
      pages: ["/cart", "/checkout"],
      estimated_minutes: 4, coupon_id: coupons[0]._id,
      schedule: { start_date: ago(20), end_date: new Date("2026-06-01"), daily_cap: 10, total_cap: 300 },
      status: "active",
      stats: { total_started: 89, total_completed: 71, total_rewarded: 71, avg_engagement_score: 68 },
    },
    {
      project_id: projects[1]._id, client_id: clientUsers[1]._id,
      title: "Browse new arrivals",
      description: "Visit homepage, browse the shop, and check a product.",
      pages: ["/", "/shop", "/p/:id"],
      estimated_minutes: 5, coupon_id: coupons[2]._id,
      schedule: { start_date: ago(25), end_date: new Date("2026-06-01"), daily_cap: 15, total_cap: 200 },
      status: "active",
      stats: { total_started: 89, total_completed: 62, total_rewarded: 62, avg_engagement_score: 71 },
    },
    {
      project_id: projects[2]._id, client_id: clientUsers[2]._id,
      title: "BrewLab product discovery",
      description: "Explore the homepage and at least one product.",
      pages: ["/", "/products/:id"],
      estimated_minutes: 4, coupon_id: coupons[3]._id,
      schedule: { start_date: ago(15), end_date: new Date("2026-06-01"), daily_cap: 10, total_cap: 150 },
      status: "active",
      stats: { total_started: 54, total_completed: 41, total_rewarded: 41, avg_engagement_score: 76 },
    },
  ]);
  console.log(`Created ${tasks.length} tasks.\n`);

  // ---- Sessions + Events + Fixations ----
  console.log("Creating sessions, events, and fixations…");
  const allEvents = [];
  const allFixations = [];
  const sessionDocs = [];

  const sessionConfig = [
    // [project_idx, task_idx, page_set, session_count]
    [0, 0, ["/", "/collections/:id", "/products/:id"], 45],
    [0, 1, ["/cart", "/checkout"], 30],
    [1, 2, ["/", "/shop", "/p/:id"], 35],
    [2, 3, ["/", "/products/:id"], 25],
    // Extra single-page sessions for homepage depth
    [0, 0, ["/"], 20],
    [1, 2, ["/shop"], 15],
  ];

  for (const [projIdx, taskIdx, pagePaths, count] of sessionConfig) {
    const project = projects[projIdx];
    const task = tasks[taskIdx];

    for (let i = 0; i < count; i++) {
      const consumer = pick(consumerUsers);
      const sessionId = uid("sess");
      const sessionStart = ago(rng(0, 28), 23);
      const durationMs = rng(60000, 600000);
      const { score, breakdown } = computeEngagement();
      const accepted = score >= 60;

      // Pages visited
      const pagesVisited = pagePaths.map((path, pi) => ({
        path,
        entered_at: new Date(sessionStart.getTime() + pi * 45000),
        left_at: new Date(sessionStart.getTime() + (pi + 1) * 45000),
      }));

      const sessionDoc = {
        session_id: sessionId,
        consumer_id: consumer._id,
        task_id: task._id,
        project_id: project._id,
        status: "completed",
        pages_visited: pagesVisited,
        pages_required: pagePaths,
        task_completed: true,
        engagement_score: score,
        engagement_breakdown: breakdown,
        data_accepted: accepted,
        reward_given: true,
        duration_ms: durationMs,
        active_time_ms: Math.floor(durationMs * rngF(0.6, 0.95)),
        started_at: sessionStart,
        ended_at: new Date(sessionStart.getTime() + durationMs),
        summary: {
          total_fixations: rng(30, 120),
          total_clicks: rng(2, 15),
          total_scroll_events: rng(20, 80),
          max_scroll_depth_percent: rngF(10, 100),
          rage_clicks: rng(0, 3),
          dead_clicks: rng(0, 4),
          scroll_backs: rng(0, 6),
          confusion_score: rng(5, 65),
        },
      };
      sessionDocs.push(sessionDoc);

      if (accepted) {
        // Generate events and fixations only for accepted sessions
        pagePaths.forEach((pagePath, pi) => {
          const pageStart = new Date(sessionStart.getTime() + pi * 45000);
          const evts = makeEvents(sessionId, project._id, consumer._id, pagePath, pageStart);
          allEvents.push(...evts);
        });
        const fixs = makeFixations(sessionId, project._id, pagePaths, sessionStart);
        allFixations.push(...fixs);
      }
    }
  }

  // Bulk insert sessions
  await Session.insertMany(sessionDocs);
  console.log(`Created ${sessionDocs.length} sessions.`);

  // Bulk insert events in batches of 5000
  const EVENT_BATCH = 5000;
  for (let i = 0; i < allEvents.length; i += EVENT_BATCH) {
    await db.collection("events").insertMany(allEvents.slice(i, i + EVENT_BATCH));
  }
  console.log(`Inserted ${allEvents.length} events.`);

  // Bulk insert fixations
  await db.collection("fixations").insertMany(allFixations);
  console.log(`Inserted ${allFixations.length} fixations.\n`);

  // ---- Update project counters ----
  console.log("Updating project counters…");
  for (const project of projects) {
    const count = await Session.countDocuments({ project_id: project._id });
    const healthScores = await Session.find({ project_id: project._id, data_accepted: true })
      .select("engagement_score")
      .lean();
    const avgHealth =
      healthScores.length > 0
        ? Math.round(healthScores.reduce((a, s) => a + s.engagement_score, 0) / healthScores.length)
        : 0;
    await Project.updateOne(
      { _id: project._id },
      { total_sessions: count, health_score: avgHealth }
    );
  }
  console.log("Project counters updated.\n");

  // ---- Done ----
  console.log("=== Seed complete ===");
  console.log(`Users:     ${clientUsers.length + consumerUsers.length}`);
  console.log(`Projects:  ${projects.length}`);
  console.log(`Coupons:   ${coupons.length}`);
  console.log(`Tasks:     ${tasks.length}`);
  console.log(`Sessions:  ${sessionDocs.length}`);
  console.log(`Events:    ${allEvents.length}`);
  console.log(`Fixations: ${allFixations.length}`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
