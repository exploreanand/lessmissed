import Event from "@/lib/models/Event";
import Fixation from "@/lib/models/Fixation";

const DISPERSION_THRESHOLD = 100; // px — max x-spread + y-spread to count as one fixation
const MIN_DURATION_MS = 150;      // discard fixation candidates shorter than this

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

function buildFixation(samples, sessionId, projectId, pageUrl) {
  const xs = samples.map((s) => s.data.x);
  const ys = samples.map((s) => s.data.y);
  const elementIds = samples.map((s) => s.data.element_id).filter(Boolean);
  const elementId = mode(elementIds);
  const xpathSample = samples.find((s) => s.data.element_id === elementId);

  return {
    session_id: sessionId,
    project_id: projectId,
    page_url: pageUrl,
    element_id: elementId ?? null,
    element_xpath: xpathSample?.data.element_xpath ?? null,
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
    { "data.x": 1, "data.y": 1, "data.element_id": 1, "data.element_xpath": 1, timestamp: 1, page_url: 1 }
  )
    .sort({ timestamp: 1 })
    .lean();

  if (!gazeEvents.length) return 0;

  // Group by page_url so fixations don't span page navigations
  const byPage = {};
  for (const ev of gazeEvents) {
    (byPage[ev.page_url] ??= []).push(ev);
  }

  const fixations = [];

  for (const [pageUrl, samples] of Object.entries(byPage)) {
    if (samples.length < 2) continue;

    let window = [samples[0]];

    for (let i = 1; i < samples.length; i++) {
      const candidate = [...window, samples[i]];
      const xs = candidate.map((s) => s.data.x);
      const ys = candidate.map((s) => s.data.y);
      const dispersion =
        Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));

      if (dispersion <= DISPERSION_THRESHOLD) {
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
