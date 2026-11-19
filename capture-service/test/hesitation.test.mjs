// INS-GC03 Hesitation Time — the pairing rule, with no database involved.
//
// This suite must never skip. The number it guards is a duration shown to a
// brand as evidence of friction, and the two ways to get it wrong are both
// silent: pairing a click with a look that happened *after* it, and averaging
// in a gap where the user wandered off and came back.
//
// GC02 (clickedWithoutLooking.js) cannot be imported here — it resolves its
// models through the "@/" alias, which Node has no map for. That is exactly
// why hesitation.js uses relative imports instead. The partition test at the
// bottom therefore carries a copy of GC02's rule, in the same style as
// fixationWindows.test.mjs's verbatim copy of the old clusterer loop.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const h = await import(`${LIB}/hesitation.js`);
// The real matcher, not a copy — describeElement.js has no imports of its own.
const { isInstrumentElement } = await import(`${LIB}/describeElement.js`);

const BASE = 1_700_000_000_000;

/** A fixation on `key`, starting `atMs` into the session. */
function fix(session, key, atMs, { duration_ms = 300, element_id = key } = {}) {
  return {
    session_id: session,
    element_key: key,
    element_id,
    duration_ms,
    start_timestamp: new Date(BASE + atMs).toISOString(),
  };
}

/** A click event on `key`, `atMs` into the session. Shape matches Event.find. */
function click(session, key, atMs, data = {}) {
  return {
    session_id: session,
    timestamp: new Date(BASE + atMs).toISOString(),
    data: key === null ? { ...data } : { element_id: key, element_key: key, ...data },
  };
}

const stats = (fixations, clicks, totalSessions = 1) =>
  h.computeHesitationStats({ fixations, clicks, totalSessions });

// ── the pair ───────────────────────────────────────────────────────────────

test("a look then a click 800ms later is one confident pair", () => {
  const r = stats([fix("s1", "#cta", 0)], [click("s1", "#cta", 800)]);

  assert.equal(r.pairs_measured, 1);
  assert.equal(r.pairs_over_cap, 0);
  assert.equal(r.sessions_measured, 1);
  assert.equal(r.median_hesitation_ms, 800);
  assert.equal(r.avg_hesitation_ms, 800);
  assert.equal(r.p90_hesitation_ms, 800);

  const confident = r.bands.find((b) => b.band === "confident");
  assert.equal(confident.pair_count, 1);
  assert.equal(confident.pct, 100);
});

test("a click with no prior look is not a pair — that is GC02's insight", () => {
  const r = stats([fix("s1", "#other", 0)], [click("s1", "#cta", 800)]);

  assert.equal(r.pairs_measured, 0);
  assert.equal(r.total_clicks, 1, "the click is still counted in the denominator");
  assert.equal(r.median_hesitation_ms, 0);
});

test("a look that happened AFTER the click is not a pair", () => {
  // The decision was already made; there is no hesitation to time. Without
  // this guard the pair would land as a negative duration.
  const r = stats([fix("s1", "#cta", 1000)], [click("s1", "#cta", 500)]);
  assert.equal(r.pairs_measured, 0);
});

test("a sub-200ms fixation is a saccade tail, not having seen it", () => {
  const r = stats([fix("s1", "#cta", 0, { duration_ms: 150 })], [click("s1", "#cta", 800)]);
  assert.equal(r.pairs_measured, 0);
});

test("the earliest qualifying look wins, even if the input is unsorted", () => {
  const r = stats(
    [fix("s1", "#cta", 5000), fix("s1", "#cta", 1000)],
    [click("s1", "#cta", 6000)]
  );
  assert.equal(r.median_hesitation_ms, 5000, "6000 - 1000, not 6000 - 5000");
});

test("one pair per session and element — a second click is the same decision", () => {
  const r = stats([fix("s1", "#cta", 0)], [click("s1", "#cta", 800), click("s1", "#cta", 5000)]);

  assert.equal(r.pairs_measured, 1);
  assert.equal(r.median_hesitation_ms, 800, "the click they acted on, not the last one");
});

// ── the cap ────────────────────────────────────────────────────────────────

test("a 45s gap is counted and excluded, never averaged in", () => {
  const r = stats(
    [fix("s1", "#cta", 0), fix("s2", "#cta", 0)],
    [click("s1", "#cta", 800), click("s2", "#cta", 45_000)],
    2
  );

  assert.equal(r.pairs_measured, 1);
  assert.equal(r.pairs_over_cap, 1);
  assert.equal(r.median_hesitation_ms, 800, "the 45s pair must not move the median");
});

test("when every pair is over the cap, say so rather than report a median", () => {
  const r = stats([fix("s1", "#cta", 0)], [click("s1", "#cta", 45_000)]);

  assert.equal(r.pairs_measured, 0);
  assert.equal(r.pairs_over_cap, 1);
  assert.equal(r.median_hesitation_ms, 0);
  assert.deepEqual(r.top_elements, []);
});

// ── the statistics ─────────────────────────────────────────────────────────

test("median over an even number of pairs averages the middle two", () => {
  const fixations = ["s1", "s2", "s3", "s4"].map((s) => fix(s, "#cta", 0));
  const clicks = [200, 400, 600, 800].map((ms, i) => click(`s${i + 1}`, "#cta", ms));
  const r = stats(fixations, clicks, 4);

  assert.equal(r.pairs_measured, 4);
  assert.equal(r.median_hesitation_ms, 500);
  assert.equal(r.avg_hesitation_ms, 500);
  assert.equal(r.p90_hesitation_ms, 800, "nearest-rank: an observed value");
});

test("p90 over ten pairs is the ninth, not an interpolation", () => {
  const sessions = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const fixations = sessions.map((s) => fix(s, "#cta", 0));
  const clicks = sessions.map((s, i) => click(s, "#cta", (i + 1) * 100));
  const r = stats(fixations, clicks, 10);

  assert.equal(r.pairs_measured, 10);
  assert.equal(r.p90_hesitation_ms, 900);
});

test("band edges are closed at the bottom: 1000 considers, 3000 is friction", () => {
  const r = stats(
    [fix("s1", "#a", 0), fix("s2", "#b", 0), fix("s3", "#c", 0)],
    [click("s1", "#a", 999), click("s2", "#b", 1000), click("s3", "#c", 3000)],
    3
  );

  const by = Object.fromEntries(r.bands.map((b) => [b.band, b.pair_count]));
  assert.deepEqual(by, { confident: 1, considered: 1, friction: 1 });
  assert.equal(r.median_hesitation_ms, 1000);
});

// ── the ranking ────────────────────────────────────────────────────────────

test("an element only one session paused on stays out of the ranking", () => {
  const r = stats(
    [fix("s1", "#cta", 0), fix("s1", "#buy", 0), fix("s2", "#buy", 0)],
    [click("s1", "#cta", 800), click("s1", "#buy", 2000), click("s2", "#buy", 2200)],
    2
  );

  assert.equal(r.pairs_measured, 3, "all three pairs still count toward the median");
  assert.deepEqual(
    r.top_elements.map((e) => e.key),
    ["#buy"],
    "#cta had one session — anecdote, not a page-level signal"
  );
  assert.equal(r.slowest_element.key, "#buy");
  assert.equal(r.fastest_element, null, "one ranked element is not a spread");
});

test("the gaze dot never appears — it is our instrument, not the site", () => {
  assert.equal(isInstrumentElement("#webgazerGazeDot"), true, "guard the premise");

  const r = stats(
    [
      fix("s1", "#cta", 0),
      fix("s2", "#cta", 0),
      fix("s1", "#webgazerGazeDot", 0),
      fix("s2", "#webgazerGazeDot", 0),
    ],
    [
      click("s1", "#cta", 800),
      click("s2", "#cta", 900),
      click("s1", "#webgazerGazeDot", 500),
      click("s2", "#webgazerGazeDot", 600),
    ],
    2
  );

  assert.equal(r.pairs_measured, 2);
  assert.deepEqual(r.top_elements.map((e) => e.key), ["#cta"]);
});

test("no input yields zeros with the bands still described", () => {
  const r = h.computeHesitationStats();

  assert.equal(r.pairs_measured, 0);
  assert.equal(r.median_hesitation_ms, 0);
  assert.equal(r.bands.length, 3);
  assert.deepEqual(r.bands.map((b) => b.pct), [0, 0, 0]);
  assert.equal(r.slowest_element, null);
});

test("totalSessions passes through as the outer denominator", () => {
  const r = stats([fix("s1", "#cta", 0)], [click("s1", "#cta", 800)], 42);
  assert.equal(r.total_sessions, 42);
});

// ── the partition with GC02 ────────────────────────────────────────────────

// Verbatim copy of clickedWithoutLooking.js's rule (its lines 78-106), because
// that module cannot be imported here. GC02 counts *clicks*; GC03 counts one
// *pair* per (session, element), so the fixture below deliberately has at most
// one click per (session, element) among the looked-at ones, which is what
// makes the two directly comparable.
function cwlReference({ fixations, clicks }) {
  const firstFix = new Map();
  for (const f of fixations) {
    if (f.duration_ms != null && f.duration_ms < 200) continue;
    const key = f.element_key || f.element_id;
    if (!key) continue;
    let m = firstFix.get(f.session_id);
    if (!m) {
      m = new Map();
      firstFix.set(f.session_id, m);
    }
    if (!m.has(key)) m.set(key, new Date(f.start_timestamp).getTime());
  }

  let cwl = 0;
  let eligible = 0;
  for (const c of clicks) {
    const data = c.data ?? {};
    if (isInstrumentElement(data.element_id)) continue;
    const key = data.element_key || data.element_id;
    if (!key) continue;
    eligible += 1;
    const prior = firstFix.get(c.session_id)?.get(key);
    if (!(prior != null && prior < new Date(c.timestamp).getTime())) cwl += 1;
  }
  return { cwl, eligible };
}

test("GC02 and GC03 partition every eligible click between them", () => {
  const fixations = [
    fix("s1", "#cta", 0),
    fix("s2", "#cta", 0),
    fix("s2", "#buy", 0, { duration_ms: 150 }), // saccade tail — not a look
    fix("s3", "#hero", 2000), // after the click
  ];
  const clicks = [
    click("s1", "#cta", 800), //    looked, 800ms  -> GC03 pair
    click("s1", "#nav", 100), //    never looked   -> GC02
    click("s2", "#cta", 45_000), // looked, capped -> GC03, over cap
    click("s2", "#buy", 500), //    only a saccade -> GC02
    click("s3", "#hero", 1000), //  look came after -> GC02
    click("s3", "#webgazerGazeDot", 100), // instrument -> neither
    click("s3", null, 200), //       no element at all -> neither
  ];

  const r = stats(fixations, clicks, 3);
  const { cwl, eligible } = cwlReference({ fixations, clicks });

  assert.equal(eligible, 5, "two clicks are not about the page at all");
  assert.equal(r.pairs_measured, 1);
  assert.equal(r.pairs_over_cap, 1);
  assert.equal(cwl, 3);
  assert.equal(
    r.pairs_measured + r.pairs_over_cap + cwl,
    eligible,
    "a click is either timed by GC03 or claimed by GC02 — never both, never neither"
  );
});
