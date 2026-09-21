// Relative (with extension) so the backfill script can import this module
// under plain Node, outside the Next bundler's "@/" alias.
import Event from "./models/Event.js";
import Fixation from "./models/Fixation.js";
import { isOverlayElement } from "./insights/describeElement.js";
import { normalizePath } from "./pathTemplate.js";

const DISPERSION_THRESHOLD = 100; // px — max x-spread + y-spread to count as one fixation
const MIN_DURATION_MS = 150;      // discard fixation candidates shorter than this
// Gaze streams at 10fps, so consecutive samples are ~100ms apart. A larger gap
// means the samples are not one continuous look — the consumer left the page and
// came back. Site-wide sessions revisit pages constantly (product → cart →
// product), and without this guard those two visits merge into one fixation
// spanning the whole detour.
const MAX_SAMPLE_GAP_MS = 2000;

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

function buildFixation(samples, sessionId, projectId, pageUrl) {
  const xs = samples.map((s) => s.data.x + (s.data.scroll_x ?? 0));
  const ys = samples.map((s) => s.data.y + (s.data.scroll_y ?? 0));
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

export async function deriveFixations(sessionId, projectId) {
  // Fetch all gaze events for this session in chronological order
  const gazeEvents = await Event.find(
    { session_id: sessionId, type: "gaze" },
    {
      "data.x": 1, "data.y": 1, "data.scroll_x": 1, "data.scroll_y": 1,
      "data.element_id": 1, "data.element_key": 1, "data.element_xpath": 1, "data.element_tag": 1,
      "data.element_text": 1, "data.element_alt": 1, "data.element_aria": 1,
      "data.element_src": 1, "data.element_rect": 1,
      timestamp: 1, page_url: 1, page_template: 1,
    }
  )
    .sort({ timestamp: 1 })
    .lean();

  if (!gazeEvents.length) return 0;

  // Group by page_url so fixations don't span page navigations. Samples that
  // landed on our own gaze-dot overlay are dropped here: they measure the
  // instrument, not the page, and would otherwise rank as a real element.
  const byPage = {};
  for (const ev of gazeEvents) {
    if (isOverlayElement(ev.data?.element_id)) continue;
    (byPage[ev.page_url] ??= []).push(ev);
  }

  const fixations = [];

  for (const [pageUrl, samples] of Object.entries(byPage)) {
    if (samples.length < 2) continue;

    let window = [samples[0]];

    for (let i = 1; i < samples.length; i++) {
      const candidate = [...window, samples[i]];
      const xs = candidate.map((s) => s.data.x + (s.data.scroll_x ?? 0));
      const ys = candidate.map((s) => s.data.y + (s.data.scroll_y ?? 0));
      const dispersion =
        Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
      const gapMs =
        new Date(samples[i].timestamp) - new Date(window.at(-1).timestamp);

      if (dispersion <= DISPERSION_THRESHOLD && gapMs <= MAX_SAMPLE_GAP_MS) {
        window = candidate;
      } else {
        const durationMs =
          new Date(window.at(-1).timestamp) - new Date(window[0].timestamp);
        if (window.length >= 2 && durationMs >= MIN_DURATION_MS) {
          fixations.push(buildFixation(window, sessionId, projectId, pageUrl));
        }
        window = [samples[i]];
      }
    }

    // Flush remaining window
    const durationMs =
      new Date(window.at(-1).timestamp) - new Date(window[0].timestamp);
    if (window.length >= 2 && durationMs >= MIN_DURATION_MS) {
      fixations.push(buildFixation(window, sessionId, projectId, pageUrl));
    }
  }

  if (fixations.length > 0) {
    await Fixation.insertMany(fixations, { ordered: false });
  }

  return fixations.length;
}
