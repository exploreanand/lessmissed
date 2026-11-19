// The shared ordered gaze sequence that GC05 and GC06 are both read off.
//
// Must never skip. Every sequence insight depends on one distinction: looking
// at something for a long time is ONE visit, while looking away and coming
// back is TWO. Collapse that wrongly and "never returns to the target" becomes
// either always or never true.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib/insights";
const g = await import(`${LIB}/gazeSequence.js`);

const BASE = 1_700_000_000_000;

function fix(session, key, atMs, { duration_ms = 300, element_id, region_id = null, ...rest } = {}) {
  return {
    session_id: session,
    element_key: key,
    element_id: element_id ?? key,
    region_id,
    duration_ms,
    start_timestamp: new Date(BASE + atMs).toISOString(),
    ...rest,
  };
}

const keysOf = (seq, session) => (seq.get(session) ?? []).map((v) => v.key);

test("consecutive looks at one element are a single visit", () => {
  const seq = g.buildSessionVisits({
    fixations: [fix("s1", "#a", 0), fix("s1", "#a", 400), fix("s1", "#a", 800)],
  });
  const visits = seq.get("s1");

  assert.equal(visits.length, 1);
  assert.equal(visits[0].fixation_count, 3);
  assert.equal(visits[0].start_ms, BASE);
  assert.equal(visits[0].end_ms, BASE + 1100, "the visit runs to the end of the last fixation");
});

test("away and back is two visits, not one", () => {
  const seq = g.buildSessionVisits({
    fixations: [fix("s1", "#a", 0), fix("s1", "#b", 400), fix("s1", "#a", 800)],
  });
  assert.deepEqual(keysOf(seq, "s1"), ["#a", "#b", "#a"]);
});

test("unsorted input still yields chronological order", () => {
  const seq = g.buildSessionVisits({
    fixations: [fix("s1", "#c", 800), fix("s1", "#a", 0), fix("s1", "#b", 400)],
  });
  assert.deepEqual(keysOf(seq, "s1"), ["#a", "#b", "#c"]);
});

test("a sub-200ms fixation is a saccade tail and never enters the path", () => {
  const seq = g.buildSessionVisits({
    fixations: [fix("s1", "#a", 0), fix("s1", "#blip", 400, { duration_ms: 80 }), fix("s1", "#a", 600)],
  });
  // Without the cut this would read as a departure and a return.
  assert.deepEqual(keysOf(seq, "s1"), ["#a"]);
});

test("sessions are kept apart", () => {
  const seq = g.buildSessionVisits({
    fixations: [fix("s1", "#a", 0), fix("s2", "#b", 100), fix("s1", "#c", 200)],
  });
  assert.deepEqual(keysOf(seq, "s1"), ["#a", "#c"]);
  assert.deepEqual(keysOf(seq, "s2"), ["#b"]);
});

test("the gaze dot is dropped, but a labelled region survives it", () => {
  const seq = g.buildSessionVisits({
    fixations: [
      fix("s1", "#webgazerGazeDot", 0, { element_id: "#webgazerGazeDot" }),
      fix("s1", "k1", 400, { element_id: "#webgazerGazeDot", region_id: "reg-1" }),
    ],
    regions: [{ region_id: "reg-1", label: "Hero banner" }],
  });
  const visits = seq.get("s1");

  assert.equal(visits.length, 1);
  assert.equal(visits[0].key, "reg-1", "the region is the identity when present");
  assert.equal(visits[0].label, "Hero banner");
});

test("identity ladder: region, then positional key, then selector", () => {
  assert.equal(g.elementKey({ region_id: "r", element_key: "k", element_id: "e" }), "r");
  assert.equal(g.elementKey({ region_id: null, element_key: "k", element_id: "e" }), "k");
  assert.equal(g.elementKey({ region_id: null, element_key: null, element_id: "e" }), "e");
  assert.equal(g.elementKey({}), null);
});

test("clicks group per session on the same key ladder, minus regions", () => {
  const clicks = g.buildSessionClicks({
    clicks: [
      { session_id: "s1", data: { element_key: "#cta", element_id: "#cta" } },
      { session_id: "s1", data: { element_id: "#only-id" } },
      { session_id: "s2", data: { element_key: "#cta" } },
      { session_id: "s2", data: { element_id: "#webgazerGazeDot" } },
      { session_id: "s2", data: {} },
    ],
  });

  assert.deepEqual([...clicks.get("s1")].sort(), ["#cta", "#only-id"]);
  assert.deepEqual([...clicks.get("s2")], ["#cta"], "overlay and keyless clicks dropped");
});

// ── click targets ──────────────────────────────────────────────────────────

test("only an interactive click makes an element a target", () => {
  // 78% of the clicks on the real landing page are dead ones. Counting them
  // would make nearly every paragraph a "click target".
  const targets = g.buildClickTargets({
    clicks: [
      { session_id: "s1", data: { element_key: "#cta", element_id: "#cta", is_interactive: true } },
      { session_id: "s1", data: { element_key: "#para", element_id: "#para", is_interactive: false } },
    ],
  });

  assert.deepEqual([...targets.keys()], ["#cta"]);
});

test("an element both dead-clicked and really clicked is still a target", () => {
  const targets = g.buildClickTargets({
    clicks: [
      { session_id: "s1", data: { element_key: "#cta", element_id: "#cta", is_interactive: false } },
      { session_id: "s2", data: { element_key: "#cta", element_id: "#cta", is_interactive: true } },
    ],
  });
  assert.deepEqual([...targets.keys()], ["#cta"]);
});

test("a tag that never sends the flag falls back to every clicked element", () => {
  // Insurance against the trap the gaze-status work hit: a field absent on an
  // older tag must not silently empty the card. Measured present on 100% of
  // clicks in this database, so this is not the live path.
  const targets = g.buildClickTargets({
    clicks: [
      { session_id: "s1", data: { element_key: "#cta", element_id: "#cta" } },
      { session_id: "s1", data: { element_key: "#para", element_id: "#para" } },
    ],
  });
  assert.deepEqual([...targets.keys()].sort(), ["#cta", "#para"]);
});

test("overlay and keyless clicks are never targets", () => {
  const targets = g.buildClickTargets({
    clicks: [
      { session_id: "s1", data: { element_id: "#webgazerGazeDot", is_interactive: true } },
      { session_id: "s1", data: { is_interactive: true } },
    ],
  });
  assert.equal(targets.size, 0);
});

test("a target carries its name from the click event", () => {
  // The control itself is typically never fixated, so the click is the only
  // place its real name is available.
  const targets = g.buildClickTargets({
    clicks: [{
      session_id: "s1",
      data: { element_key: "a>b", element_id: "#buy", element_tag: "button",
              element_text: "Add to cart", is_interactive: true },
    }],
  });
  // describeElement prefixes the readable tag name.
  assert.equal(targets.get("a>b").label, "Button: Add to cart");
  assert.equal(targets.get("a>b").element_id, "#buy");
});

// ── "near" the target ──────────────────────────────────────────────────────

test("a fixation on the control's own key is a look at it", () => {
  assert.equal(g.isNearKey("a>b>c", "a>b>c"), true);
});

test("a fixation on the parent container counts as near", () => {
  // The live case: gaze resolves to the container, the click to the button.
  assert.equal(g.isNearKey("a>b", "a>b>button"), true);
  assert.equal(g.isNearKey("a", "a>b>button"), true, "two levels up still near");
});

test("a fixation far above the control does not count", () => {
  // Otherwise one glance at <body> reads as a look at every button on the page.
  assert.equal(g.isNearKey("a", "a>b>c>button"), false);
  assert.equal(g.isNearKey("body", "body>main>section>div>a"), false);
});

test("a fixation inside the control counts — gaze on a button's label", () => {
  assert.equal(g.isNearKey("a>b>button>span", "a>b>button"), true);
});

test("siblings and unrelated branches are never near", () => {
  assert.equal(g.isNearKey("a>b>x", "a>b>y"), false);
  assert.equal(g.isNearKey("q>r", "a>b>c"), false);
  assert.equal(g.isNearKey("a>bb", "a>b>c"), false, "prefix must respect separators");
});

test("non-path keys only ever match exactly", () => {
  assert.equal(g.isNearKey("#cta", "#cta"), true);
  assert.equal(g.isNearKey("#cta", "#other"), false);
  assert.equal(g.keyDepth("#cta"), 1);
  assert.equal(g.keyDepth("a>b>c"), 3);
  assert.equal(g.keyDepth(null), 0);
});

test("the near radius is adjustable", () => {
  assert.equal(g.isNearKey("a", "a>b>c>d", 3), true);
  assert.equal(g.isNearKey("a", "a>b>c>d", 2), false);
});
