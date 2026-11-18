// The I-DT clusterer's rules, with no database involved.
//
// This suite must never skip: it is the only thing standing between a rewrite
// of windowGazeSamples and a silent change in every fixation number in the
// product. The partition tests below compare against a verbatim copy of the
// original recompute-per-candidate loop, which is what the running-extrema
// version replaced.

import { test } from "node:test";
import assert from "node:assert/strict";

const LIB = "../../Web-App/lessmissed/lib";
const {
  windowGazeSamples,
  isFixationWindow,
  clusterFixations,
  absX,
  absY,
  DISPERSION_THRESHOLD,
  MIN_DURATION_MS,
  MAX_SAMPLE_GAP_MS,
  MAX_FIXATION_MS,
} = await import(`${LIB}/fixationWindows.js`);

const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);

/** A gaze sample at (x, y) `ms` after the start of the stream. */
function sample(ms, x, y, extra = {}) {
  return {
    timestamp: new Date(t0 + ms),
    page_url: "/p",
    data: { viewport_x: x, viewport_y: y, scroll_x: 0, scroll_y: 0, ...extra },
  };
}

/** Flatten to the shape the original produced: closed windows plus the tail. */
function partition(samples) {
  const { windows, open } = windowGazeSamples(samples);
  const all = [...windows];
  if (isFixationWindow(open)) all.push(open);
  return all;
}
const shape = (windows) => windows.map((w) => w.length);

// ─── the original algorithm, copied from deriveFixations.js before the rewrite ───
function originalPartition(samples) {
  const out = [];
  if (samples.length < 2) return out;
  let window = [samples[0]];
  for (let i = 1; i < samples.length; i++) {
    const candidate = [...window, samples[i]];
    const xs = candidate.map((s) => absX(s.data));
    const ys = candidate.map((s) => absY(s.data));
    const dispersion =
      Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
    const gapMs = new Date(samples[i].timestamp) - new Date(window.at(-1).timestamp);
    if (dispersion <= DISPERSION_THRESHOLD && gapMs <= MAX_SAMPLE_GAP_MS) {
      window = candidate;
    } else {
      const d = new Date(window.at(-1).timestamp) - new Date(window[0].timestamp);
      if (window.length >= 2 && d >= MIN_DURATION_MS) out.push(window);
      window = [samples[i]];
    }
  }
  const d = new Date(window.at(-1).timestamp) - new Date(window[0].timestamp);
  if (window.length >= 2 && d >= MIN_DURATION_MS) out.push(window);
  return out;
}

// ─── boundaries ───────────────────────────────────────────────────────────────

test("dispersion at the threshold extends the window, past it splits", () => {
  // Samples 200ms apart, so the leading pair clears MIN_DURATION_MS on its own
  // and duration is never the reason for what follows.
  const atLimit = [sample(0, 0, 0), sample(200, 0, 0), sample(400, DISPERSION_THRESHOLD, 0)];
  assert.deepEqual(shape(partition(atLimit)), [3], "sum of ranges == 100 is one fixation");

  const past = [sample(0, 0, 0), sample(200, 0, 0), sample(400, DISPERSION_THRESHOLD + 1, 0)];
  assert.deepEqual(shape(partition(past)), [2], "101 splits; the lone tail sample is dropped");
});

test("dispersion is the sum of both ranges, not a radius", () => {
  // 60 across + 60 down = 120, past the threshold, though neither axis is.
  const s = [sample(0, 0, 0), sample(100, 60, 60)];
  assert.deepEqual(shape(partition(s)), [], "60+60 exceeds 100, so neither window survives");
});

test("sample gap at the limit extends, past it splits", () => {
  const atLimit = [sample(0, 0, 0), sample(MAX_SAMPLE_GAP_MS, 0, 0)];
  assert.deepEqual(shape(partition(atLimit)), [2]);

  const past = [sample(0, 0, 0), sample(MAX_SAMPLE_GAP_MS + 1, 0, 0)];
  assert.deepEqual(shape(partition(past)), [], "two 1-sample windows, both discarded");
});

test("a window shorter than the minimum duration is discarded", () => {
  const tooShort = [sample(0, 0, 0), sample(MIN_DURATION_MS - 1, 0, 0)];
  assert.deepEqual(shape(partition(tooShort)), []);

  const justLong = [sample(0, 0, 0), sample(MIN_DURATION_MS, 0, 0)];
  assert.deepEqual(shape(partition(justLong)), [2]);
});

test("a single sample is never a fixation", () => {
  assert.deepEqual(partition([]), []);
  assert.deepEqual(partition([sample(0, 0, 0)]), []);
});

test("MAX_FIXATION_MS caps how long one window may span", () => {
  // A gaze that never moves, 10fps. Without the cap this is one window for as
  // long as the visitor leaves the tab open.
  const stare = [];
  for (let ms = 0; ms <= MAX_FIXATION_MS + 5000; ms += 100) stare.push(sample(ms, 500, 400));

  const windows = partition(stare);
  assert.ok(windows.length >= 2, `expected the cap to split the stare, got ${windows.length}`);
  for (const w of windows) {
    const span = new Date(w.at(-1).timestamp) - new Date(w[0].timestamp);
    assert.ok(span <= MAX_FIXATION_MS, `window spans ${span}ms, over the ${MAX_FIXATION_MS}ms cap`);
  }
});

test("a sample with no usable coordinate splits, and the next one recovers", () => {
  const s = [
    sample(0, 100, 100),
    sample(100, 100, 100),
    sample(200, 100, 100),
    { timestamp: new Date(t0 + 300), page_url: "/p", data: { scroll_x: 0, scroll_y: 0 } },
    sample(400, 100, 100),
    sample(500, 100, 100),
    sample(600, 100, 100),
  ];
  assert.ok(Number.isNaN(absX(s[3].data)), "the planted sample really has no x");
  assert.deepEqual(shape(partition(s)), [3, 3], "NaN ends one fixation and is not carried into the next");
});

// ─── equivalence with the algorithm this replaced ─────────────────────────────

test("partitions match the original algorithm on hand-built streams", () => {
  const streams = {
    "two clean fixations": [
      sample(0, 100, 100), sample(100, 105, 102), sample(200, 98, 104),
      sample(300, 600, 600), sample(400, 604, 598), sample(500, 601, 603),
    ],
    "a long gap in the middle": [
      sample(0, 100, 100), sample(100, 102, 101), sample(200, 101, 99),
      sample(5000, 100, 100), sample(5100, 101, 102), sample(5200, 99, 101),
    ],
    "drifting past the threshold": [
      sample(0, 0, 0), sample(100, 30, 0), sample(200, 60, 0),
      sample(300, 90, 0), sample(400, 120, 0), sample(500, 150, 0),
    ],
    "saccade too short to keep": [
      sample(0, 0, 0), sample(50, 0, 0), sample(100, 900, 900), sample(150, 900, 900),
    ],
  };
  for (const [name, stream] of Object.entries(streams)) {
    assert.deepEqual(
      shape(partition(stream)),
      shape(originalPartition(stream)),
      `partition differs from the original for "${name}"`
    );
  }
});

test("partitions match the original algorithm on randomised streams", () => {
  // Seeded, so a failure is reproducible.
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const scenarios = [
    { name: "mixed", jump: 0.12, gap: 0.06, nan: 0 },
    { name: "near-stationary", jump: 0.005, gap: 0.005, nan: 0 },
    { name: "jumpy", jump: 0.6, gap: 0.3, nan: 0 },
    { name: "with dropped coordinates", jump: 0.12, gap: 0.06, nan: 0.08 },
  ];

  for (const sc of scenarios) {
    for (let trial = 0; trial < 40; trial++) {
      const n = 2 + Math.floor(rnd() * 150);
      const stream = [];
      let ms = 0, x = 500, y = 400;
      for (let i = 0; i < n; i++) {
        if (rnd() < sc.jump) { x += (rnd() - 0.5) * 600; y += (rnd() - 0.5) * 600; }
        else { x += (rnd() - 0.5) * 18; y += (rnd() - 0.5) * 18; }
        ms += rnd() < sc.gap ? 100 + rnd() * 4000 : 80 + rnd() * 45;
        const s = sample(Math.round(ms), Math.round(x), Math.round(y));
        if (sc.nan && rnd() < sc.nan) { delete s.data.viewport_x; delete s.data.viewport_y; }
        stream.push(s);
      }
      // Keep streams under the cap, which the original has no notion of.
      if (new Date(stream.at(-1).timestamp) - new Date(stream[0].timestamp) > MAX_FIXATION_MS) continue;
      assert.deepEqual(
        shape(partition(stream)),
        shape(originalPartition(stream)),
        `partition differs from the original (${sc.name}, n=${n}, seed trail ${trial})`
      );
    }
  }
});

// ─── cost ─────────────────────────────────────────────────────────────────────

test("a stationary gaze is linear, not quadratic", () => {
  // The case that used to take 68 seconds and block the event loop for all of
  // it: one window growing to the length of the session.
  const stare = [];
  for (let i = 0; i < 70_000; i++) stare.push(sample(i * 100, 500, 400));

  const startedAt = Date.now();
  const windows = partition(stare);
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 2000, `took ${elapsed}ms; the point of the rewrite is that this is fast`);
  const span = 70_000 * 100;
  assert.ok(
    windows.length >= Math.floor(span / MAX_FIXATION_MS),
    `expected the stare to be split into at least ${Math.floor(span / MAX_FIXATION_MS)} fixations, got ${windows.length}`
  );
});

// ─── grouping ────────────────────────────────────────────────────────────────

test("fixations never span a page navigation", () => {
  const stream = [
    { ...sample(0, 100, 100), page_url: "/a" },
    { ...sample(100, 101, 100), page_url: "/a" },
    { ...sample(200, 100, 101), page_url: "/a" },
    { ...sample(300, 100, 100), page_url: "/b" },
    { ...sample(400, 101, 100), page_url: "/b" },
    { ...sample(500, 100, 101), page_url: "/b" },
  ];
  const fixations = clusterFixations(stream, "sess_x", "proj_x");
  assert.equal(fixations.length, 2, "one fixation per page, not one spanning both");
  assert.deepEqual(fixations.map((f) => f.page_url).sort(), ["/a", "/b"]);
});

test("samples on our own gaze-dot overlay are dropped", () => {
  const stream = [
    sample(0, 100, 100, { element_id: "#webgazerGazeDot" }),
    sample(100, 101, 100, { element_id: "#webgazerGazeDot" }),
    sample(200, 100, 101, { element_id: "#webgazerGazeDot" }),
  ];
  assert.deepEqual(clusterFixations(stream, "sess_x", "proj_x"), []);
});
