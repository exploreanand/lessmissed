// INS-GC06 Comparison Behavior — A-B-A-B weighing-up, with no database.
//
// Must never skip. The card claims "visitors compared these two things N times
// before choosing", so the rules that stop it seeing comparisons everywhere
// are the ones under test: both sides must be looked at twice inside the same
// 10s, and the two must actually have been adjacent in the gaze path.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const c = await import(`${LIB}/comparison.js`);
const g = await import(`${LIB}/gazeSequence.js`);

const BASE = 1_700_000_000_000;

function fix(session, key, atMs, duration_ms = 300) {
  return {
    session_id: session,
    element_key: key,
    element_id: key,
    region_id: null,
    duration_ms,
    start_timestamp: new Date(BASE + atMs).toISOString(),
  };
}

/** [key, atMs] pairs -> fixations for one session. */
const walk = (session, steps) => steps.map(([k, t]) => fix(session, k, t));

function run(fixations, clicks = [], totalSessions = 1) {
  return c.computeComparisonStats({
    sequences: g.buildSessionVisits({ fixations }),
    clicksBySession: g.buildSessionClicks({ clicks }),
    totalSessions,
  });
}

const click = (session, key) => ({
  session_id: session,
  data: { element_id: key, element_key: key, is_interactive: true },
});

// ── the pattern ────────────────────────────────────────────────────────────

test("A-B-A-B inside ten seconds is one comparison", () => {
  const r = run(walk("s1", [["#a", 0], ["#b", 500], ["#a", 1000], ["#b", 1500]]));

  assert.equal(r.total_comparisons, 1);
  assert.equal(r.sessions_comparing, 1);
  assert.equal(r.avg_alternations, 3, "three switches across A-B-A-B");
});

test("one look at each side is not a comparison", () => {
  // A-B-A: they glanced back, they did not weigh anything up.
  const r = run(walk("s1", [["#a", 0], ["#b", 500], ["#a", 1000]]));
  assert.equal(r.total_comparisons, 0);
});

test("the same alternation spread over half a minute is not a comparison", () => {
  const r = run(walk("s1", [["#a", 0], ["#b", 4000], ["#a", 8000], ["#b", 12_000]]));
  assert.equal(r.total_comparisons, 0, "no 10s window holds two of each");
});

test("a long steady look is one visit and never compares with itself", () => {
  const r = run(walk("s1", [["#a", 0], ["#a", 400], ["#a", 800], ["#a", 1200]]));
  assert.equal(r.total_comparisons, 0);
});

test("two elements never adjacent in the path are not being compared", () => {
  // A and C both appear twice within the window, but the gaze never went
  // directly between them — B is always in the middle.
  const r = run(
    walk("s1", [
      ["#a", 0], ["#b", 400], ["#c", 800], ["#b", 1200],
      ["#a", 1600], ["#b", 2000], ["#c", 2400],
    ])
  );

  const ids = r.top_pairs.map((p) => [p.a.key, p.b.key].sort().join("|"));
  assert.ok(!ids.includes("#a|#c"), "A and C were never looked at back to back");
});

test("alternations count the switches, not the visits", () => {
  const r = run(
    walk("s1", [["#a", 0], ["#b", 400], ["#a", 800], ["#b", 1200], ["#a", 1600]])
  );
  assert.equal(r.avg_alternations, 4);
});

// ── nesting jitter, which is most of what the raw pattern finds ────────────

test("a block and its own child are not two things being compared", () => {
  // Gaze resolution flickers between a container and the text inside it, which
  // is a textbook A-B-A-B with nothing compared. 39% of adjacent pairs on the
  // real landing page were this.
  const r = run(
    walk("s1", [
      ["main>card", 0], ["main>card>title", 400],
      ["main>card", 800], ["main>card>title", 1200],
    ])
  );

  assert.equal(r.total_comparisons, 0);
  assert.equal(r.pairs_found, 0);
});

test("siblings under one parent are still a real pair", () => {
  const r = run(
    walk("s1", [
      ["main>cardA", 0], ["main>cardB", 400],
      ["main>cardA", 800], ["main>cardB", 1200],
    ])
  );
  assert.equal(r.total_comparisons, 1);
});

// ── two options, or two blocks of copy ─────────────────────────────────────

test("a pair counts as choosable only when each side holds a control", () => {
  const steps = [["main>cardA", 0], ["main>cardB", 400], ["main>cardA", 800], ["main>cardB", 1200]];
  const targets = g.buildClickTargets({
    clicks: [
      click("s0", "main>cardA>button"),
      click("s0", "main>cardB>button"),
    ].map((x) => ({ ...x, data: { ...x.data } })),
  });

  const both = c.computeComparisonStats({
    sequences: g.buildSessionVisits({ fixations: walk("s1", steps) }),
    clicksBySession: new Map(),
    targets,
    totalSessions: 1,
  });
  assert.equal(both.choosable_pairs, 1);

  // Only one side has a control: not two options.
  const oneSided = c.computeComparisonStats({
    sequences: g.buildSessionVisits({ fixations: walk("s1", steps) }),
    clicksBySession: new Map(),
    targets: g.buildClickTargets({ clicks: [click("s0", "main>cardA>button")] }),
    totalSessions: 1,
  });
  assert.equal(oneSided.choosable_pairs, 0);
  assert.equal(oneSided.total_comparisons, 1, "still a comparison, just not of options");
});

test("two real options outrank two blocks of copy", () => {
  const options = [["main>cardA", 0], ["main>cardB", 400], ["main>cardA", 800], ["main>cardB", 1200]];
  const copy = [["main>p1", 0], ["main>p2", 400], ["main>p1", 800], ["main>p2", 1200], ["main>p1", 1600]];

  const fixations = [
    ...walk("s1", options), ...walk("s2", options),
    ...walk("s3", copy), ...walk("s4", copy), ...walk("s5", copy),
  ];
  const r = c.computeComparisonStats({
    sequences: g.buildSessionVisits({ fixations }),
    clicksBySession: new Map(),
    targets: g.buildClickTargets({
      clicks: [click("s0", "main>cardA>button"), click("s0", "main>cardB>button")],
    }),
    totalSessions: 5,
  });

  assert.equal(r.top_pairs[0].both_choosable, true);
  assert.equal(r.top_pairs[0].sessions, 2, "fewer sessions, but they are options");
  assert.equal(r.top_pairs[1].both_choosable, false);
  assert.equal(r.top_pairs[1].sessions, 3);
});

// ── choosing ───────────────────────────────────────────────────────────────

test("a click inside a compared block counts as choosing it", () => {
  // Gaze lands on the card; the click lands on the button inside it. Demanding
  // the same key would report that nobody ever chooses.
  const r = run(
    walk("s1", [
      ["main>cardA", 0], ["main>cardB", 500],
      ["main>cardA", 1000], ["main>cardB", 1500],
    ]),
    [click("s1", "main>cardA>button")],
    1
  );

  assert.equal(r.total_comparisons, 1);
  assert.equal(r.comparisons_with_choice, 1);
  const pair = r.top_pairs[0] ?? null;
  assert.equal(pair, null, "one session is below the ranking floor");
});

test("comparing and then walking away is recorded as choosing neither", () => {
  const r = run(
    walk("s1", [["#a", 0], ["#b", 500], ["#a", 1000], ["#b", 1500]]),
    [click("s1", "#somewhere-else")],
    1
  );
  assert.equal(r.total_comparisons, 1);
  assert.equal(r.comparisons_with_choice, 0);
});

// ── ranking ────────────────────────────────────────────────────────────────

test("a pair needs two sessions before it is named, and reports its winner", () => {
  const steps = [["main>cardA", 0], ["main>cardB", 500], ["main>cardA", 1000], ["main>cardB", 1500]];
  const r = run(
    [...walk("s1", steps), ...walk("s2", steps)],
    [click("s1", "main>cardB>button"), click("s2", "main>cardB>button")],
    4
  );

  assert.equal(r.top_pairs.length, 1);
  const pair = r.top_pairs[0];
  assert.equal(pair.sessions, 2);
  assert.equal(pair.pct_sessions, 50);
  assert.equal(pair.avg_alternations, 3);
  assert.equal(pair.clicked_b, 2);
  assert.equal(pair.clicked_a, 0);
  assert.equal(pair.winner, "b");
});

test("an even split has no winner", () => {
  const steps = [["main>cardA", 0], ["main>cardB", 500], ["main>cardA", 1000], ["main>cardB", 1500]];
  const r = run(
    [...walk("s1", steps), ...walk("s2", steps)],
    [click("s1", "main>cardA>button"), click("s2", "main>cardB>button")],
    2
  );

  assert.equal(r.top_pairs[0].clicked_a, 1);
  assert.equal(r.top_pairs[0].clicked_b, 1);
  assert.equal(r.top_pairs[0].winner, null, "a tie is a finding, not a missing value");
});

test("pairs rank by how many sessions compared them", () => {
  const ab = [["#a", 0], ["#b", 500], ["#a", 1000], ["#b", 1500]];
  const xy = [["#x", 0], ["#y", 500], ["#x", 1000], ["#y", 1500]];
  const r = run(
    [...walk("s1", ab), ...walk("s2", ab), ...walk("s3", ab), ...walk("s4", xy), ...walk("s5", xy)],
    [],
    5
  );

  assert.deepEqual(
    r.top_pairs.map((p) => [[p.a.key, p.b.key].sort().join("|"), p.sessions]),
    [["#a|#b", 3], ["#x|#y", 2]]
  );
  assert.equal(r.pct_sessions_comparing, 100);
});

test("no sessions at all yields the empty shape", () => {
  const r = c.computeComparisonStats({ totalSessions: 5 });
  assert.equal(r.total_sessions, 5);
  assert.equal(r.total_comparisons, 0);
  assert.equal(r.avg_alternations, 0);
  assert.deepEqual(r.top_pairs, []);
});
