// INS-GC04 Attention-to-Action Ratio — the arithmetic, with no database.
//
// Must never skip. The headline this feeds ("11:1") is a claim about a brand's
// conversion funnel, and the way to get it wrong is subtle: dividing sessions
// that looked by sessions that *clicked* rather than by the sessions that did
// both. An element clicked only by people who never looked at it then scores
// as though it converts, when in truth nobody who saw it ever acted.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const a = await import(`${LIB}/attentionToAction.js`);

/** A fixation $group row: `sessions` are the sessions that looked at `key`. */
function fg(key, sessions, extra = {}) {
  return {
    _id: key,
    sessions,
    fixation_count: sessions.length,
    element_id: key,
    element_tag: "button",
    ...extra,
  };
}

/** A click $group row. */
function cg(key, sessions) {
  return { _id: key, sessions, click_count: sessions.length };
}

const stats = (fixationGroups, clickGroups, totalSessions = 10, regions = []) =>
  a.computeAttentionToActionStats({ fixationGroups, clickGroups, regions, totalSessions });

const sess = (n, prefix = "s") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

// ── the ratio ──────────────────────────────────────────────────────────────

test("ten looked, two of them acted, so the ratio is 5:1", () => {
  const r = stats([fg("#cta", sess(10))], [cg("#cta", ["s1", "s2"])]);
  const el = r.top_elements[0];

  assert.equal(el.sessions_with_fixation, 10);
  assert.equal(el.sessions_fixated_and_clicked, 2);
  assert.equal(el.ratio, 5);
  assert.equal(el.ratio_text, "5", "a clean ratio must not read as 5.0");
});

test("a clicking session that never looked cannot improve the ratio", () => {
  // The trap. |S_C| is 1, so a bare count comparison would report 4:1 and call
  // this element converting. Nobody who saw it ever acted on it.
  const r = stats([fg("#cta", sess(4))], [cg("#cta", ["s99"])]);
  const el = r.looked_not_clicked[0];

  assert.equal(el.ratio, null, "no intersection means infinite, not 4:1");
  assert.equal(el.ratio_text, "∞");
  assert.equal(r.top_elements.length, 0, "an unconverted element is GC01's subject");
  assert.equal(r.never_clicked_count, 1);
});

test("the ratio satisfies A2A = 1 / (1 - LBNC) exactly", () => {
  const r = stats([fg("#cta", sess(5))], [cg("#cta", ["s1", "s2"])]);
  const el = r.top_elements[0];

  assert.equal(el.looked_not_clicked_rate, 60);
  assert.equal(el.ratio, 2.5);
  assert.equal(el.ratio, 1 / (1 - el.looked_not_clicked_rate / 100));
});

test("the ratio is computed from counts, not from the rounded percentage", () => {
  // 6 looks per action is a 5/6 = 83.33% LBNC, which displays as 83. Deriving
  // the ratio from that rounded figure would give 5.88:1, not 6:1 — so the
  // two must be computed independently from the session counts.
  const r = stats([fg("#cta", sess(6))], [cg("#cta", ["s1"])]);
  const el = r.top_elements[0];

  assert.equal(el.ratio, 6, "exactly 6, not 1/(1-0.83)");
  assert.equal(el.looked_not_clicked_rate, 83, "rounded for display");
  assert.notEqual(el.ratio, 1 / (1 - 83 / 100));
});

test("one decimal, so 10 looks per 3 actions is 3.3:1", () => {
  const r = stats([fg("#cta", sess(10))], [cg("#cta", ["s1", "s2", "s3"])]);
  assert.equal(r.top_elements[0].ratio_text, "3.3");
});

// ── the bands, which are the spec's own numbers ─────────────────────────────

test("bands follow the spec: <2 converting, >10 friction, edges are 'watch'", () => {
  const r = stats(
    [
      fg("#good", sess(3, "g")), //  3 looked, 2 acted -> 1.5
      fg("#mid", sess(10, "m")), // 10 looked, 2 acted -> 5
      fg("#bad", sess(22, "b")), // 22 looked, 2 acted -> 11
      fg("#edge", sess(10, "e")), // 10 looked, 5 acted -> exactly 2
      fg("#edge2", sess(10, "x")), // 10 looked, 1 acted -> exactly 10
    ],
    [
      cg("#good", ["g1", "g2"]),
      cg("#mid", ["m1", "m2"]),
      cg("#bad", ["b1", "b2"]),
      cg("#edge", ["e1", "e2", "e3", "e4", "e5"]),
      cg("#edge2", ["x1"]),
    ],
    30
  );

  const band = Object.fromEntries(r.top_elements.map((e) => [e.key, e.band]));
  assert.deepEqual(band, {
    "#good": "converting",
    "#mid": "watch",
    "#bad": "friction",
    "#edge": "watch", // 2 is not < 2
    "#edge2": "watch", // 10 is not > 10
  });
  assert.equal(r.friction_count, 1);
  assert.equal(r.converting_count, 1);
});

test("ranked worst-first — the friction end is the actionable one", () => {
  const r = stats(
    [fg("#a", sess(4, "a")), fg("#b", sess(20, "b")), fg("#c", sess(8, "c"))],
    [cg("#a", ["a1", "a2"]), cg("#b", ["b1", "b2"]), cg("#c", ["c1", "c2"])],
    30
  );
  assert.deepEqual(r.top_elements.map((e) => e.key), ["#b", "#c", "#a"]);
});

test("median ratio is over the elements that convert, not the infinite ones", () => {
  const r = stats(
    [fg("#a", sess(4, "a")), fg("#b", sess(8, "b")), fg("#z", sess(5, "z"))],
    [cg("#a", ["a1", "a2"]), cg("#b", ["b1", "b2"])], // #z never clicked
    30
  );
  // ratios are 2 and 4; an infinite one must not drag the median anywhere.
  assert.equal(r.median_ratio, 3);
  assert.equal(r.median_ratio_text, "3");
  assert.equal(r.never_clicked_count, 1);
});

// ── eligibility and labels ──────────────────────────────────────────────────

test("an element one session looked at is counted but never ranked", () => {
  const r = stats([fg("#solo", ["s1"]), fg("#cta", sess(6))], [cg("#cta", ["s1", "s2"])]);

  assert.equal(r.elements_looked, 2);
  assert.deepEqual(r.top_elements.map((e) => e.key), ["#cta"]);
});

test("the gaze dot is dropped, but a labelled region survives", () => {
  const r = stats(
    [
      fg("#webgazerGazeDot", sess(4, "d"), { element_id: "#webgazerGazeDot" }),
      fg("key-1", sess(4, "r"), { element_id: "#webgazerGazeDot", region_id: "reg-1" }),
    ],
    [cg("key-1", ["r1", "r2"])],
    10,
    [{ region_id: "reg-1", label: "Hero banner" }]
  );

  assert.deepEqual(r.top_elements.map((e) => e.key), ["key-1"]);
  assert.equal(r.top_elements[0].label, "Hero banner", "region label beats the selector");
});

// ── GC01's list, which now shares this arithmetic ───────────────────────────

test("looked-not-clicked holds only elements over half, worst reach first", () => {
  const r = stats(
    [
      fg("#wide", sess(8, "w")), //  8 looked, 1 acted -> LBNC 88
      fg("#narrow", sess(4, "n")), // 4 looked, 1 acted -> LBNC 75
      fg("#fine", sess(4, "f")), //   4 looked, 3 acted -> LBNC 25, excluded
    ],
    [cg("#wide", ["w1"]), cg("#narrow", ["n1"]), cg("#fine", ["f1", "f2", "f3"])],
    10
  );

  assert.deepEqual(r.looked_not_clicked.map((e) => e.key), ["#wide", "#narrow"]);
  assert.equal(r.looked_not_clicked[0].lbnc_pct, 88);
  assert.equal(r.looked_not_clicked[0].pct_looked, 80);
  assert.equal(r.looked_not_clicked[0].pct_clicked, 10);
});

test("pct_clicked counts sessions that looked AND acted, not every clicker", () => {
  // Otherwise GC01's bar could show more clicked than looked.
  const r = stats([fg("#cta", sess(4))], [cg("#cta", ["s1", "s90", "s91", "s92", "s93"])], 10);
  const el = r.looked_not_clicked[0];

  assert.equal(el.pct_looked, 40);
  assert.equal(el.pct_clicked, 10, "one of the four lookers acted");
  assert.ok(el.pct_clicked <= el.pct_looked);
});

test("no fixations at all yields the empty shape", () => {
  const r = a.computeAttentionToActionStats({ totalSessions: 7 });

  assert.equal(r.total_sessions, 7);
  assert.equal(r.elements_looked, 0);
  assert.equal(r.median_ratio_text, "—", "an em dash, never a zero ratio");
  assert.deepEqual(r.top_elements, []);
  assert.deepEqual(r.looked_not_clicked, []);
});
