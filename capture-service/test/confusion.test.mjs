// INS-SL01 Confusion Score — the composite, with no database.
//
// Must never skip. This is the one insight that reduces a whole session to a
// single number a brand will act on, so the things under test are the spec's
// weights, the ramps that turn raw counts into them, and above all what happens
// when a component cannot be measured: a session that never clicked must not be
// credited with a confident click.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const cf = await import(`${LIB}/confusion.js`);

const BASE = 1_700_000_000_000;

/** Scroll events at [depth_pct, atMs]. */
const scrolls = (session, steps) =>
  steps.map(([depth_pct, atMs]) => ({
    session_id: session,
    timestamp: new Date(BASE + atMs).toISOString(),
    data: { depth_pct },
  }));

const visitsOf = (...keys) => keys.map((key) => ({ key }));

// ── scroll-backs, mirroring INS-S03's rule ─────────────────────────────────

test("one continuous trip back up is one scroll-back", () => {
  const c = cf.countScrollBacksBySession({
    scrollEvents: scrolls("s1", [[10, 0], [40, 500], [35, 1000], [20, 1500], [10, 2000]]),
  });
  assert.equal(c.get("s1"), 1, "a 30% pullback in three steps is not three events");
});

test("a wiggle under five percent is not a scroll-back", () => {
  const c = cf.countScrollBacksBySession({
    scrollEvents: scrolls("s1", [[40, 0], [38, 500], [40, 1000]]),
  });
  assert.equal(c.get("s1"), 0);
});

test("a session that scrolled without going back is measured as zero", () => {
  // Present with 0, not absent: a later zero must mean "they did not scroll
  // back", never "we never watched them scroll".
  const c = cf.countScrollBacksBySession({
    scrollEvents: scrolls("s1", [[10, 0], [50, 500], [90, 1000]]),
  });
  assert.equal(c.has("s1"), true);
  assert.equal(c.get("s1"), 0);
});

test("a long pause ends a run instead of bridging it", () => {
  // Scrolling down, walking away, then scrolling up a minute later is two
  // motions, not one 40% pullback.
  const c = cf.countScrollBacksBySession({
    scrollEvents: scrolls("s1", [[50, 0], [10, 60_000]]),
  });
  assert.equal(c.get("s1"), 0);
});

test("scrolling down again closes the run, and a second trip up counts again", () => {
  const c = cf.countScrollBacksBySession({
    scrollEvents: scrolls("s1", [
      [50, 0], [20, 500],   // up 30 -> one
      [60, 1000],           // back down, closes it
      [30, 1500],           // up 30 -> two
    ]),
  });
  assert.equal(c.get("s1"), 2);
});

test("a run still open at the end of the session counts", () => {
  const c = cf.countScrollBacksBySession({
    scrollEvents: scrolls("s1", [[60, 0], [20, 500]]),
  });
  assert.equal(c.get("s1"), 1);
});

test("sessions are counted apart, whatever order the events arrive in", () => {
  const c = cf.countScrollBacksBySession({
    scrollEvents: [
      ...scrolls("s2", [[70, 0], [20, 500]]),
      ...scrolls("s1", [[10, 0], [50, 500]]),
    ],
  });
  assert.equal(c.get("s1"), 0);
  assert.equal(c.get("s2"), 1);
});

// ── one session's score ────────────────────────────────────────────────────

test("too short a session is unscored, not scored calm", () => {
  assert.equal(cf.scoreSessionConfusion({ visits: visitsOf("a", "b") }), null);
});

test("no backtracking, no scroll-backs and a quick click is zero", () => {
  const r = cf.scoreSessionConfusion({
    visits: visitsOf("a", "b", "c", "d"),
    scrollBacks: 0,
    hesitationMs: 400,
  });
  assert.equal(r.score, 0);
  assert.equal(r.band, "calm");
  assert.equal(r.weight_used, 100, "all four components were measurable");
});

test("everything maxed out is a hundred", () => {
  const r = cf.scoreSessionConfusion({
    // 5 unique keys revisited repeatedly: 10 revisits out of 15 visits.
    visits: visitsOf("a", "b", "c", "d", "e", "a", "b", "c", "d", "e", "a", "b", "c", "d", "e"),
    scrollBacks: 9,
    hesitationMs: 20_000,
  });
  assert.equal(r.score, 100);
  assert.equal(r.band, "confused");
});

test("the spec's weights are what get applied", () => {
  // Backtracking alone maxed: 90 unique keys then 10 repeats is 10 revisits
  // (full marks) across 100 visits, a ratio of exactly 0.1 (zero marks).
  const visits = [
    ...Array.from({ length: 90 }, (_, i) => ({ key: `k${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ({ key: `k${i}` })),
  ];
  const r = cf.scoreSessionConfusion({ visits, scrollBacks: 0, hesitationMs: 500 });

  assert.equal(r.components.backtracking, 100);
  assert.equal(r.components.refixation, 0);
  assert.equal(r.components.scroll_backs, 0);
  assert.equal(r.components.hesitation, 0);
  assert.equal(r.score, 30, "backtracking is 30 of the 100 available weight");
});

test("an unmeasurable component is dropped and the rest renormalized", () => {
  const visits = [
    ...Array.from({ length: 90 }, (_, i) => ({ key: `k${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ({ key: `k${i}` })),
  ];
  // A session that never clicked, and never scrolled: only the two gaze
  // components are available, so backtracking is 30 of 50, not 30 of 100.
  const r = cf.scoreSessionConfusion({ visits });

  assert.equal(r.weight_used, 50);
  assert.equal(r.score, 60);
  assert.equal(r.hesitation_ms, null);
  assert.equal(r.scroll_backs, null);
  assert.equal("hesitation" in r.components, false, "not scored zero — not scored at all");
});

test("hesitation shares its zero mark with GC03's confident band", () => {
  const base = { visits: visitsOf("a", "b", "c", "d"), scrollBacks: 0 };
  assert.equal(cf.scoreSessionConfusion({ ...base, hesitationMs: 1000 }).components.hesitation, 0);
  assert.ok(cf.scoreSessionConfusion({ ...base, hesitationMs: 3000 }).components.hesitation > 0);
});

// ── nesting jitter, which was most of the backtracking signal ──────────────

test("bouncing between a block and its own child is not backtracking", () => {
  // Gaze flickers between a container and the text inside it. Counting those
  // bounces as returns inflated revisits on the real landing page by 58%.
  const r = cf.scoreSessionConfusion({
    visits: visitsOf(
      "main>card", "main>card>title", "main>card", "main>card>title",
      "main>promo", "main>footer"
    ),
    scrollBacks: 0,
    hesitationMs: 300,
  });

  assert.equal(r.visits, 3, "the card, the promo, the footer");
  assert.equal(r.revisits, 0, "the eye never left the card's subtree");
  assert.equal(r.score, 0);
});

test("a genuine return to an unrelated element still counts", () => {
  const r = cf.scoreSessionConfusion({
    visits: visitsOf("main>a", "main>b", "main>a", "main>b"),
    scrollBacks: 0,
    hesitationMs: 300,
  });
  assert.equal(r.revisits, 2);
});

test("a session that collapses below the floor is unscored", () => {
  const r = cf.scoreSessionConfusion({
    visits: visitsOf("main>card", "main>card>title", "main>card>title>span", "main>card"),
    scrollBacks: 4,
  });
  assert.equal(r, null, "a dozen flickers on one block is not a readable session");
});

test("collapseNested keeps the outermost key it arrived on", () => {
  const settled = cf.collapseNested(
    visitsOf("a>b", "a>b>c", "a>b>c>d", "x>y", "a>b")
  );
  assert.deepEqual(settled.map((v) => v.key), ["a>b", "x>y", "a>b"]);
});

// ── the page aggregate ─────────────────────────────────────────────────────

function statsFor(sessions) {
  const sequences = new Map();
  const scrollBacksBySession = new Map();
  const hesitationPairs = [];
  for (const [id, s] of Object.entries(sessions)) {
    sequences.set(id, visitsOf(...s.visits));
    if (s.scrollBacks != null) scrollBacksBySession.set(id, s.scrollBacks);
    for (const ms of s.hesitations ?? []) hesitationPairs.push({ session_id: id, hesitation_ms: ms });
  }
  return cf.computeConfusionStats({
    sequences,
    hesitationPairs,
    scrollBacksBySession,
    totalSessions: Object.keys(sessions).length,
  });
}

test("the page reports the spread, not just an average", () => {
  const r = statsFor({
    calm: { visits: ["a", "b", "c", "d"], scrollBacks: 0, hesitations: [300] },
    lost: {
      visits: ["a", "b", "c", "a", "b", "c", "a", "b", "c", "a", "b", "c"],
      scrollBacks: 8,
      hesitations: [15_000],
    },
  });

  assert.equal(r.sessions_scored, 2);
  assert.equal(r.bands.find((b) => b.band === "calm").session_count, 1);
  assert.equal(r.bands.find((b) => b.band === "confused").session_count, 1);
  assert.equal(r.worst_sessions[0].session_id, "lost", "worst first");
  assert.ok(r.avg_score > 0 && r.avg_score < 100);
});

test("component coverage counts the sessions each signal was available for", () => {
  const r = statsFor({
    full: { visits: ["a", "b", "c", "d"], scrollBacks: 1, hesitations: [2000] },
    gazeOnly: { visits: ["a", "b", "c", "d"] },
  });

  assert.equal(r.component_coverage.backtracking, 2);
  assert.equal(r.component_coverage.refixation, 2);
  assert.equal(r.component_coverage.scroll_backs, 1);
  assert.equal(r.component_coverage.hesitation, 1);
});

test("a pause beyond GC03's cap is not folded into hesitation", () => {
  const r = statsFor({
    s1: { visits: ["a", "b", "c", "d"], scrollBacks: 0, hesitations: [45_000] },
  });
  assert.equal(r.component_coverage.hesitation, 0, "looked, left, came back later");
  assert.equal(r.worst_sessions[0].hesitation_ms, null);
});

test("short sessions are excluded from the page average entirely", () => {
  const r = statsFor({
    tiny: { visits: ["a"], scrollBacks: 9 },
    real: { visits: ["a", "b", "c", "d"], scrollBacks: 0, hesitations: [300] },
  });
  assert.equal(r.sessions_scored, 1);
  assert.equal(r.total_sessions, 2, "still reported as the denominator");
});

test("nothing to score yields the empty shape with the weights intact", () => {
  const r = cf.computeConfusionStats({ totalSessions: 4 });
  assert.equal(r.total_sessions, 4);
  assert.equal(r.sessions_scored, 0);
  assert.equal(r.avg_score, 0);
  assert.deepEqual(r.weights, { backtracking: 30, scroll_backs: 25, hesitation: 25, refixation: 20 });
  assert.equal(r.bands.length, 3);
});

test("the weights are the spec's and sum to a hundred", () => {
  const total = Object.values(cf.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(total, 100);
  assert.deepEqual(cf.WEIGHTS, {
    backtracking: 30,
    scroll_backs: 25,
    hesitation: 25,
    refixation: 20,
  });
});
