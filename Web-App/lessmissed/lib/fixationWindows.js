// The I-DT clusterer, with no database in it.
//
// Split out of deriveFixations.js so it can be unit-tested under bare `node`
// and so the windowing rules live in exactly one place. Plain relative imports
// (with .js) for the same reason the rest of this family avoids the "@/" alias:
// the capture worker and the backfill scripts load these modules with no
// bundler. See deriveFixations.js / finalizeSession.js / pathTemplate.js.

import { isOverlayElement } from "./insights/describeElement.js";
import { normalizePath } from "./pathTemplate.js";

export const DISPERSION_THRESHOLD = 100; // px — max x-spread + y-spread to count as one fixation
export const MIN_DURATION_MS = 150;      // discard fixation candidates shorter than this
// Gaze streams at 10fps, so consecutive samples are ~100ms apart. A larger gap
// means the samples are not one continuous look — the consumer left the page and
// came back. Site-wide sessions revisit pages constantly (product → cart →
// product), and without this guard those two visits merge into one fixation
// spanning the whole detour.
export const MAX_SAMPLE_GAP_MS = 2000;
// Hard ceiling on how long one window may span.
//
// Without it a stationary gaze — dispersion under the threshold, gaps under the
// sample limit, which is what a frozen WebGazer prediction on a static page
// looks like — grows a single window to the length of the whole session. That
// was the pathological case behind two production failures: the old clusterer
// was quadratic in window length, and past ~65k samples `Math.max(...xs)` threw
// RangeError, which finalize swallowed and then saved the session as completed
// with zero fixations. The quadratic cost is gone (running extrema, below), but
// the cap stays: 30s of a gaze that never moves 100px is an instrument artefact,
// not a look, and nothing downstream benefits from reporting it as one fixation.
export const MAX_FIXATION_MS = 30000;

function tsMs(sample) {
  return new Date(sample.timestamp).getTime();
}

function avg(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function mode(arr) {
  if (!arr.length) return null;
  const freq = {};
  let best = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    freq[v] = (freq[v] ?? 0) + 1;
    if (freq[v] > bestCount) { bestCount = freq[v]; best = v; }
  }
  return best;
}

// Pick the first non-empty value for a key across the samples that belong to
// the modal element — a single sample can miss alt/aria even when its siblings
// carry it, so we don't rely on the one representative sample alone.
function firstOf(samples, key) {
  for (const s of samples) {
    const v = s.data?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Tag gaze events store the smoothed viewport coordinate as viewport_x/_y; the
// older extension stream used x/y. Either way the absolute page position is the
// viewport coordinate plus the scroll offset at sample time. Reading only x/y
// here silently yielded NaN dispersion for every tag session, so no fixations
// were ever derived from tag data.
export function absX(d) {
  const b = d.viewport_x ?? d.x;
  return b == null ? NaN : b + (d.scroll_x ?? 0);
}
export function absY(d) {
  const b = d.viewport_y ?? d.y;
  return b == null ? NaN : b + (d.scroll_y ?? 0);
}

export function buildFixation(samples, sessionId, projectId, pageUrl) {
  const xs = samples.map((s) => absX(s.data));
  const ys = samples.map((s) => absY(s.data));
  const elementIds = samples.map((s) => s.data.element_id).filter(Boolean);
  const elementId = mode(elementIds);
  const xpathSample = samples.find((s) => s.data.element_id === elementId);

  // Semantics come only from samples on the modal element, so a stray sample
  // that drifted onto a neighbour can't contribute someone else's label.
  const own = samples.filter((s) => s.data.element_id === elementId);
  const semanticSamples = own.length ? own : samples;
  const rect = semanticSamples.find((s) => s.data?.element_rect)?.data.element_rect ?? null;

  return {
    session_id: sessionId,
    project_id: projectId,
    page_url: pageUrl,
    // Stamped per fixation rather than used as the grouping key: grouping stays
    // on the raw URL so a fixation can never span a navigation, while queries
    // still aggregate every product page onto one "/products/:id" row.
    page_template: samples[0]?.page_template || normalizePath(pageUrl),
    element_id: elementId ?? null,
    element_key: firstOf(semanticSamples, "element_key"),
    element_xpath: xpathSample?.data.element_xpath ?? null,
    element_tag: firstOf(semanticSamples, "element_tag"),
    element_text: firstOf(semanticSamples, "element_text"),
    element_alt: firstOf(semanticSamples, "element_alt"),
    element_aria: firstOf(semanticSamples, "element_aria"),
    element_src: firstOf(semanticSamples, "element_src"),
    element_rect: rect
      ? {
          x: rect.x ?? null,
          y: rect.y ?? null,
          w: rect.w ?? null,
          h: rect.h ?? null,
        }
      : undefined,
    center_x: Math.round(avg(xs)),
    center_y: Math.round(avg(ys)),
    duration_ms: new Date(samples.at(-1).timestamp) - new Date(samples[0].timestamp),
    start_timestamp: new Date(samples[0].timestamp),
    end_timestamp: new Date(samples.at(-1).timestamp),
    sample_count: samples.length,
  };
}

/**
 * Is this window a fixation, or just noise to be thrown away?
 *
 * Two samples is the minimum that can have a duration at all, and anything
 * under MIN_DURATION_MS is a saccade passing through rather than a look.
 */
export function isFixationWindow(window) {
  if (window.length < 2) return false;
  return tsMs(window.at(-1)) - tsMs(window[0]) >= MIN_DURATION_MS;
}

/**
 * Walk one page's samples in time order and partition them into fixation
 * windows. `samples` must already be sorted by timestamp.
 *
 * Returns the windows that are provably finished, plus `open` — the trailing
 * window, which a later sample could still have extended. Callers that know
 * the stream has ended (a session being finalized) flush `open` through
 * isFixationWindow; a caller reading a session that is still live would hold it
 * back.
 *
 * Extrema are carried forward rather than recomputed per candidate. Nothing is
 * ever removed from a window, so a running min/max is exact — and it turns what
 * used to be O(n²) in window length, with a spread-argument limit lurking at
 * ~65k samples, into a single linear pass.
 */
export function windowGazeSamples(samples) {
  const windows = [];
  if (!samples.length) return { windows, open: [] };

  let window = [samples[0]];
  let minX = absX(samples[0].data);
  let maxX = minX;
  let minY = absY(samples[0].data);
  let maxY = minY;

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    const x = absX(sample.data);
    const y = absY(sample.data);
    const nextMinX = Math.min(minX, x);
    const nextMaxX = Math.max(maxX, x);
    const nextMinY = Math.min(minY, y);
    const nextMaxY = Math.max(maxY, y);
    // Sum of ranges, not a radius — same measure the original used.
    const dispersion = nextMaxX - nextMinX + (nextMaxY - nextMinY);
    const gapMs = tsMs(sample) - tsMs(window.at(-1));
    const spanMs = tsMs(sample) - tsMs(window[0]);

    // A sample with no usable coordinate makes dispersion NaN, so every
    // comparison below is false and the window closes. That is deliberate: such
    // a sample can only ever start a window, never extend one, so NaN can never
    // be carried into a window of two or more samples.
    if (
      dispersion <= DISPERSION_THRESHOLD &&
      gapMs <= MAX_SAMPLE_GAP_MS &&
      spanMs <= MAX_FIXATION_MS
    ) {
      window.push(sample);
      minX = nextMinX;
      maxX = nextMaxX;
      minY = nextMinY;
      maxY = nextMaxY;
    } else {
      if (isFixationWindow(window)) windows.push(window);
      window = [sample];
      minX = maxX = x;
      minY = maxY = y;
    }
  }

  return { windows, open: window };
}

/**
 * Group gaze events by the page they happened on, dropping samples that landed
 * on our own gaze-dot overlay: they measure the instrument, not the page, and
 * would otherwise rank as a real element.
 *
 * Grouping on the raw page_url rather than the template is what stops a
 * fixation spanning a navigation.
 */
export function groupSamplesByPage(gazeEvents) {
  const byPage = new Map();
  for (const ev of gazeEvents) {
    if (isOverlayElement(ev.data?.element_id)) continue;
    const key = ev.page_url;
    const bucket = byPage.get(key);
    if (bucket) bucket.push(ev);
    else byPage.set(key, [ev]);
  }
  return byPage;
}

/**
 * The whole clusterer, over a finished stream: group by page, window each
 * group, and flush every window including the trailing one.
 */
export function clusterFixations(gazeEvents, sessionId, projectId) {
  const fixations = [];
  for (const [pageUrl, samples] of groupSamplesByPage(gazeEvents)) {
    const { windows, open } = windowGazeSamples(samples);
    for (const window of windows) {
      fixations.push(buildFixation(window, sessionId, projectId, pageUrl));
    }
    if (isFixationWindow(open)) {
      fixations.push(buildFixation(open, sessionId, projectId, pageUrl));
    }
  }
  return fixations;
}
