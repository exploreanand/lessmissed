// INS-GC05 Distraction Mapping — which element takes the attention a click
// target lost, with no database.
//
// Must never skip. This card names an element as the reason another element
// went unclicked, which is an accusation, so the two rules that keep it honest
// are tested directly: the target must be something somebody actually clicks,
// and the defection recorded must be the one the session never recovered from.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const d = await import(`${LIB}/distraction.js`);
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

function click(session, key) {
  return { session_id: session, data: { element_id: key, element_key: key } };
}

/** Drives the real sequence builders, so the pure layer is tested end to end. */
function run(fixations, clicks, totalSessions) {
  return d.computeDistractionStats({
    sequences: g.buildSessionVisits({ fixations }),
    clicksBySession: g.buildSessionClicks({ clicks }),
    totalSessions,
  });
}

// A path through several elements, 400ms apart.
const path = (session, ...keys) => keys.map((k, i) => fix(session, k, i * 400));

// ── the defection ──────────────────────────────────────────────────────────

test("looking at a target then leaving for good is one defection", () => {
  // s1's click is what makes #cta a target at all; s2 is the session that
  // looked at it and wandered off.
  const r = run([...path("s1", "#cta"), ...path("s2", "#cta", "#promo")], [click("s1", "#cta")], 2);

  assert.equal(r.targets_considered, 1);
  assert.equal(r.total_defections, 1);
  assert.equal(r.sessions_with_distraction, 1);
  assert.equal(r.pct_sessions_with_distraction, 50);
  assert.equal(r.abandoned_at_end, 0);
});

test("a session that clicked the target lost nothing", () => {
  const r = run([...path("s1", "#cta", "#promo")], [click("s1", "#cta")], 1);

  assert.equal(r.targets_considered, 1, "#cta is still a target");
  assert.equal(r.total_defections, 0, "they acted on it — no attention was stolen");
});

test("an element nobody ever clicks is not a target", () => {
  // Otherwise every paragraph on the page reads as an abandoned CTA.
  const r = run([...path("s1", "#cta"), ...path("s2", "#hero", "#promo")], [click("s1", "#cta")], 2);
  assert.equal(r.total_defections, 0);
});

test("ending the session on the target blames no element", () => {
  const r = run([...path("s1", "#cta"), ...path("s2", "#promo", "#cta")], [click("s1", "#cta")], 2);

  assert.equal(r.abandoned_at_end, 1);
  assert.equal(r.total_defections, 0, "nothing pulled them away; the recording stopped");
  assert.deepEqual(r.top_distractors, []);
});

test("the defection recorded is the one they never came back from", () => {
  // #promo took them away and lost them again; #footer is where they stayed.
  const r = run(
    [...path("s1", "#cta"), ...path("s2", "#cta", "#promo", "#cta", "#footer")],
    [click("s1", "#cta")],
    2
  );

  assert.equal(r.total_defections, 1);
  const target = r.top_targets.find((t) => t.key === "#cta");
  assert.equal(target, undefined, "one session is below the ranking floor");
  // Nothing ranked, but the single defection must have gone to #footer.
  const r2 = run(
    [
      ...path("s1", "#cta"),
      ...path("s2", "#cta", "#promo", "#cta", "#footer"),
      ...path("s3", "#cta", "#promo", "#cta", "#footer"),
    ],
    [click("s1", "#cta")],
    3
  );
  assert.deepEqual(r2.top_distractors.map((x) => x.key), ["#footer"], "#promo was recovered from");
});

// ── ranking ────────────────────────────────────────────────────────────────

test("a distractor needs two sessions before it is named", () => {
  const one = run([...path("s1", "#cta"), ...path("s2", "#cta", "#promo")], [click("s1", "#cta")], 2);
  assert.equal(one.total_defections, 1);
  assert.deepEqual(one.top_distractors, [], "one wandering eye is not cannibalization");

  const two = run(
    [...path("s1", "#cta"), ...path("s2", "#cta", "#promo"), ...path("s3", "#cta", "#promo")],
    [click("s1", "#cta")],
    3
  );
  assert.equal(two.top_distractors.length, 1);
  assert.equal(two.top_distractors[0].key, "#promo");
  assert.equal(two.top_distractors[0].sessions, 2);
  assert.equal(two.top_distractors[0].targets_affected, 1);
  // describeElement renders a bare selector with no DOM text as "Element (…)".
  assert.deepEqual(two.top_distractors[0].top_target, {
    key: "#cta",
    label: "Element (#cta)",
    sessions: 2,
  });
});

test("distractors rank by how many sessions they took, worst first", () => {
  const r = run(
    [
      ...path("s0", "#cta"),
      ...path("s1", "#cta", "#promo"),
      ...path("s2", "#cta", "#promo"),
      ...path("s3", "#cta", "#promo"),
      ...path("s4", "#cta", "#footer"),
      ...path("s5", "#cta", "#footer"),
    ],
    [click("s0", "#cta")],
    6
  );

  assert.deepEqual(r.top_distractors.map((x) => [x.key, x.sessions]), [
    ["#promo", 3],
    ["#footer", 2],
  ]);
  assert.equal(r.total_defections, 5);
  assert.equal(r.sessions_with_distraction, 5);
});

test("the abandoned target reports what took its attention", () => {
  const r = run(
    [...path("s0", "#buy"), ...path("s1", "#buy", "#promo"), ...path("s2", "#buy", "#promo")],
    [click("s0", "#buy")],
    3
  );

  assert.equal(r.top_targets.length, 1);
  assert.equal(r.top_targets[0].key, "#buy");
  assert.equal(r.top_targets[0].sessions_abandoned, 2);
  assert.equal(r.top_targets[0].pct_sessions, 67);
  assert.equal(r.top_targets[0].top_distractor.key, "#promo");
});

test("one distractor can cannibalize several targets", () => {
  const r = run(
    [
      ...path("s0", "#buy", "#cta"),
      ...path("s1", "#buy", "#promo"),
      ...path("s2", "#buy", "#promo"),
      ...path("s3", "#cta", "#promo"),
      ...path("s4", "#cta", "#promo"),
    ],
    [click("s0", "#buy"), click("s0", "#cta")],
    5
  );

  assert.equal(r.targets_considered, 2);
  assert.equal(r.top_distractors[0].key, "#promo");
  assert.equal(r.top_distractors[0].sessions, 4);
  assert.equal(r.top_distractors[0].targets_affected, 2);
  assert.equal(r.top_targets.length, 2);
});

// ── which elements may be called targets ───────────────────────────────────

test("an element that was only dead-clicked is not a target", () => {
  // The whole point of threading targets in: someone stabbing at a paragraph
  // must not turn that paragraph into an abandoned CTA.
  const fixations = [...path("s1", "#para", "#promo"), ...path("s2", "#para", "#promo")];
  const clicks = [
    { session_id: "s0", data: { element_key: "#para", element_id: "#para", is_interactive: false } },
  ];

  const withTargets = d.computeDistractionStats({
    sequences: g.buildSessionVisits({ fixations }),
    clicksBySession: g.buildSessionClicks({ clicks }),
    targets: g.buildClickTargets({ clicks }),
    totalSessions: 3,
  });
  assert.equal(withTargets.targets_considered, 0);
  assert.equal(withTargets.total_defections, 0);

  // And the same data with the element genuinely interactive does report it.
  const live = [
    { session_id: "s0", data: { element_key: "#para", element_id: "#para", is_interactive: true } },
  ];
  const real = d.computeDistractionStats({
    sequences: g.buildSessionVisits({ fixations }),
    clicksBySession: g.buildSessionClicks({ clicks: live }),
    targets: g.buildClickTargets({ clicks: live }),
    totalSessions: 3,
  });
  assert.equal(real.targets_considered, 1);
  assert.equal(real.total_defections, 2);
});

test("omitting targets falls back to every clicked element", () => {
  const r = run([...path("s1", "#cta"), ...path("s2", "#cta", "#promo")], [click("s1", "#cta")], 2);
  assert.equal(r.targets_considered, 1, "the fallback keeps the pure function usable alone");
});

// ── looking NEAR the target, which is what real data looks like ────────────

test("a look at the control's container counts, and the control keeps its name", () => {
  // No interactive control in this database was ever fixated directly; gaze
  // lands on the container. Requiring an exact match makes the insight dead.
  const TARGET = "main>section>div>button";
  const CONTAINER = "main>section>div";
  const clicks = [{
    session_id: "s0",
    data: { element_key: TARGET, element_id: "#buy", element_tag: "button",
            element_text: "Buy now", is_interactive: true },
  }];

  const fixations = [
    ...path("s1", CONTAINER, "main>promo"),
    ...path("s2", CONTAINER, "main>promo"),
  ];

  const r = d.computeDistractionStats({
    sequences: g.buildSessionVisits({ fixations }),
    clicksBySession: g.buildSessionClicks({ clicks }),
    targets: g.buildClickTargets({ clicks }),
    totalSessions: 3,
  });

  assert.equal(r.targets_considered, 1);
  assert.equal(r.targets_reachable, 1, "the container look reached the control");
  assert.equal(r.total_defections, 2);
  assert.equal(
    r.top_targets[0].label,
    "Button: Buy now",
    "named from the click, not the container it was seen through"
  );
  assert.equal(r.top_distractors[0].key, "main>promo");
});

test("a target nobody looked near is counted but not reachable", () => {
  // The honest zero: not "nobody was distracted" but "gaze never got there".
  const clicks = [{
    session_id: "s0",
    data: { element_key: "deep>down>in>a>corner>button", element_id: "#x", is_interactive: true },
  }];
  const r = d.computeDistractionStats({
    sequences: g.buildSessionVisits({ fixations: path("s1", "main>hero", "main>promo") }),
    clicksBySession: g.buildSessionClicks({ clicks }),
    targets: g.buildClickTargets({ clicks }),
    totalSessions: 2,
  });

  assert.equal(r.targets_considered, 1);
  assert.equal(r.targets_reachable, 0);
  assert.equal(r.total_defections, 0);
});

test("drifting from one container to another near the same target is not a defection", () => {
  // Both looks are near the control, so the session never left it.
  const TARGET = "main>section>div>button";
  const clicks = [{
    session_id: "s0",
    data: { element_key: TARGET, element_id: "#buy", is_interactive: true },
  }];
  const r = d.computeDistractionStats({
    sequences: g.buildSessionVisits({
      fixations: path("s1", "main>section>div", "main>section>div>button>span"),
    }),
    clicksBySession: g.buildSessionClicks({ clicks }),
    targets: g.buildClickTargets({ clicks }),
    totalSessions: 1,
  });

  assert.equal(r.targets_reachable, 1);
  assert.equal(r.abandoned_at_end, 1, "the last look was still on the control");
  assert.equal(r.total_defections, 0);
});

// ── nothing to say ─────────────────────────────────────────────────────────

test("with no clicks on the page there are no targets and no claims", () => {
  const r = run([...path("s1", "#hero", "#promo", "#footer")], [], 1);

  assert.equal(r.targets_considered, 0);
  assert.equal(r.total_defections, 0);
  assert.deepEqual(r.top_distractors, []);
  assert.deepEqual(r.top_targets, []);
});

test("no sessions at all yields the empty shape", () => {
  const r = d.computeDistractionStats({ totalSessions: 0 });
  assert.equal(r.total_sessions, 0);
  assert.equal(r.targets_considered, 0);
  assert.deepEqual(r.top_distractors, []);
});
