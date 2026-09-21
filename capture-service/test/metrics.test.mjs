// Engagement score (SRS §6) and per-page metrics.
//
// Every one of these numbers used to be a permanent 0: nothing computed them.
// The engagement boundaries below are the SRS table's own "zero marks" and
// "full marks", so a test failing here means the implementation has drifted
// from the spec, not merely from itself.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const e = await import(`${LIB}/engagement.js`);
const m = await import(`${LIB}/pageMetrics.js`);

/** n fixations on n distinct elements, spaced `gap` px apart vertically. */
function fixations(n, { gap = 50, template = "/", distinct = true } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    center_x: 400,
    center_y: 100 + i * gap,
    element_key: distinct ? `el-${i}` : "el-0",
    page_template: template,
    start_timestamp: new Date(1_700_000_000_000 + i * 500).toISOString(),
    duration_ms: 300,
  }));
}

// ── Engagement: fixation diversity (30) ────────────────────────────────────
test("diversity: ≤1 unique element is zero marks, ≥8 is full marks", () => {
  assert.equal(e.scoreFixationDiversity(fixations(1)), 0);
  assert.equal(e.scoreFixationDiversity(fixations(5, { distinct: false })), 0, "one element, many looks");
  assert.equal(e.scoreFixationDiversity(fixations(8)), 100);
  assert.equal(e.scoreFixationDiversity(fixations(20)), 100);
  const mid = e.scoreFixationDiversity(fixations(4));
  assert.ok(mid > 0 && mid < 100, `4 elements sits between, got ${mid}`);
});

// ── Engagement: saccade naturalness (25) ───────────────────────────────────
test("saccades: none or ≤1:1 is zero, 3:1–5:1 is full", () => {
  assert.equal(e.scoreSaccadeNaturalness([]), 0, "no fixations, no saccades");
  assert.equal(e.scoreSaccadeNaturalness(fixations(1)), 0, "one fixation, no saccades");

  // Alternating small/large jumps: 1:1.
  const oneToOne = [0, 100, 600, 700, 1200].map((y, i) => ({
    center_x: 0, center_y: y, page_template: "/", start_timestamp: i,
  }));
  assert.equal(e.scoreSaccadeNaturalness(oneToOne), 0, "1:1 is erratic");

  // Three small steps, one large leap: 3:1.
  const threeToOne = [0, 50, 100, 150, 900].map((y, i) => ({
    center_x: 0, center_y: y, page_template: "/", start_timestamp: i,
  }));
  assert.equal(e.scoreSaccadeNaturalness(threeToOne), 100, "3:1 is natural reading");
});

test("saccades do not cross a page navigation", () => {
  const acrossPages = [
    { center_x: 0, center_y: 0, page_template: "/", start_timestamp: 0 },
    { center_x: 0, center_y: 5000, page_template: "/products", start_timestamp: 1 },
  ];
  assert.equal(e.scoreSaccadeNaturalness(acrossPages), 0, "a jump between documents is not a saccade");
});

// ── Engagement: scroll–gaze correlation (20) ───────────────────────────────
test("correlation: r ≤ 0.2 is zero, r ≥ 0.6 is full", () => {
  const tracking = Array.from({ length: 30 }, (_, i) => ({ scroll_y: i * 100, doc_y: i * 100 + 300 }));
  assert.equal(e.scoreScrollGazeCorrelation(tracking), 100, "gaze advances with scroll");

  const noScroll = Array.from({ length: 30 }, (_, i) => ({ scroll_y: 0, doc_y: (i * 37) % 800 }));
  assert.equal(e.scoreScrollGazeCorrelation(noScroll), 0, "no scroll variance, no correlation");

  assert.equal(e.scoreScrollGazeCorrelation(tracking.slice(0, 5)), 0, "too few samples to mean anything");
});

test("pearson is exact and null where undefined", () => {
  assert.equal(e.pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.ok(Math.abs(e.pearson([1, 2, 3], [6, 4, 2]) + 1) < 1e-12);
  assert.equal(e.pearson([1, 1, 1], [1, 2, 3]), null, "zero variance");
  assert.equal(e.pearson([1], [1]), null, "one point");
});

// ── Engagement: page coverage (15) ─────────────────────────────────────────
test("coverage: ≤2 of 10 bands is zero, ≥6 is full", () => {
  const heights = new Map([["/", 1000]]);
  const inBands = (bands) =>
    bands.map((b, i) => ({ center_x: 0, center_y: b * 100 + 50, page_template: "/", start_timestamp: i }));

  assert.equal(e.scorePageCoverage(inBands([0, 1]), heights), 0);
  assert.equal(e.scorePageCoverage(inBands([0, 1, 2, 3, 4, 5]), heights), 100);
  assert.equal(e.bandsCovered(inBands([0, 0, 0, 9]), 1000), 2);
});

test("coverage is averaged per page, not smeared across the site", () => {
  const heights = new Map([["/", 1000], ["/products", 1000]]);
  const full = [0, 1, 2, 3, 4, 5].map((b) => ({ center_x: 0, center_y: b * 100 + 50, page_template: "/" }));
  const none = [{ center_x: 0, center_y: 50, page_template: "/products" }];
  // One page fully read, one barely glanced at: 100 and 0 average to 50.
  assert.equal(e.scorePageCoverage([...full, ...none], heights), 50);
});

// ── Engagement: interaction (10) and the weighted total ────────────────────
test("interaction: 0 clicks is zero, ≥3 is full", () => {
  assert.equal(e.scoreInteraction(0), 0);
  assert.equal(e.scoreInteraction(3), 100);
  assert.equal(e.scoreInteraction(10), 100);
});

test("the total uses the SRS weights, which sum to 1", () => {
  const sum = Object.values(e.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights must sum to 1, got ${sum}`);

  const { score, breakdown } = e.scoreEngagement({});
  assert.equal(score, 0, "an empty session scores 0");
  assert.deepEqual(Object.keys(breakdown).sort(), Object.keys(e.WEIGHTS).sort(),
    "breakdown keys must match Session.engagement_breakdown");
});

// ── Page metrics ───────────────────────────────────────────────────────────
test("missed elements are counted by geometry, edges inclusive", () => {
  const inventory = [
    { bbox: { x: 0, y: 0, w: 100, h: 100 } },
    { bbox: { x: 200, y: 0, w: 100, h: 100 } },
    { bbox: { x: 400, y: 0, w: 100, h: 100 } },
  ];
  const looks = [
    { center_x: 50, center_y: 50 },   // inside the first
    { center_x: 300, center_y: 100 }, // exactly on the second's bottom-right corner
  ];
  assert.deepEqual(m.computeMissed(inventory, looks), { missed: 1, total: 3, pct: 33 });
});

test("no inventory means missed is unknown, never 0", () => {
  assert.equal(m.computeMissed(null, []), null);
  assert.equal(m.computeMissed([], []), null);
});

test("health is 0–100 and null when any input is missing", () => {
  assert.equal(m.computeHealth({ missedPct: 0, avgEngagement: 100, reach: 100 }), 100);
  assert.equal(m.computeHealth({ missedPct: 100, avgEngagement: 0, reach: 0 }), 0);
  assert.equal(m.computeHealth({ missedPct: null, avgEngagement: 80, reach: 80 }), null,
    "a partial score would silently re-weight itself");
  const w = Object.values(m.HEALTH_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(w - 1) < 1e-9, "health weights must sum to 1");
});

test("average fixation is the real mean, not a stored 0", () => {
  const metrics = m.computePageMetrics({
    fixations: [
      { center_x: 0, center_y: 0, duration_ms: 200 },
      { center_x: 0, center_y: 0, duration_ms: 400 },
    ],
    sessionScores: [60, 80],
  });
  assert.equal(metrics.avg_fixation_ms, 300);
  assert.equal(metrics.fixation_count, 2);
  assert.equal(metrics.avg_engagement, 70);
});

test("a page with no data reports unknowns, not zeros", () => {
  const metrics = m.computePageMetrics({});
  assert.equal(metrics.fixation_count, 0, "a count of nothing really is 0");
  assert.equal(metrics.avg_fixation_ms, null);
  assert.equal(metrics.avg_engagement, null);
  assert.equal(metrics.missed_pct, null);
  assert.equal(metrics.health, null, "no red 0 badge for a page nobody has visited");
});

// One short visit cannot look at every element of a real page — on /, 12
// fixations against 126 elements — so on a single session health mostly
// measures how little data there is. It must be withheld, not shown as a red
// failure, which is the exact problem the fake 0 badge caused.
test("health is withheld below the minimum session count", () => {
  const inputs = { missedPct: 96, avgEngagement: 70, reach: 30 };
  assert.equal(m.computeHealth({ ...inputs, sessionCount: 1 }), null);
  assert.equal(m.computeHealth({ ...inputs, sessionCount: m.MIN_SESSIONS_FOR_HEALTH - 1 }), null);
  assert.equal(typeof m.computeHealth({ ...inputs, sessionCount: m.MIN_SESSIONS_FOR_HEALTH }), "number");
});

test("the page says why health is blank", () => {
  const inventory = [{ bbox: { x: 0, y: 0, w: 100, h: 100 } }];
  const looks = [{ center_x: 10, center_y: 10, duration_ms: 300 }];

  assert.equal(m.computePageMetrics({ fixations: looks, sessionScores: [70] }).health_pending,
    "needs_preview", "no inventory yet");
  assert.equal(m.computePageMetrics({ fixations: looks, sessionScores: [70], inventory }).health_pending,
    "needs_sessions", "inventory present, too few sessions");

  const ready = m.computePageMetrics({ fixations: looks, sessionScores: [70, 72, 74], inventory });
  assert.equal(ready.health_pending, null);
  assert.equal(typeof ready.health, "number");
  // Missed % is a plain fact and is shown even when health is withheld.
  assert.equal(m.computePageMetrics({ fixations: looks, sessionScores: [70], inventory }).missed_pct, 0);
});
