// Relative (with extension) so the backfill script can import this module
// under plain Node, outside the Next bundler's "@/" alias.
import Event from "./models/Event.js";
import Fixation from "./models/Fixation.js";
import { clusterFixations } from "./fixationWindows.js";

// The clustering rules themselves live in fixationWindows.js, which has no
// database in it. This module is the part that talks to Mongo. Re-exported so
// existing importers of the constants keep working.
export {
  DISPERSION_THRESHOLD,
  MIN_DURATION_MS,
  MAX_SAMPLE_GAP_MS,
  MAX_FIXATION_MS,
  absX,
  absY,
} from "./fixationWindows.js";

// A session this long is an abandoned tab, not a visit — 200k samples is over
// five hours at 10fps. Bounding the read keeps one pathological session from
// taking a 2GB task down with it; we derive what we have and say so loudly.
const MAX_GAZE_SAMPLES = 200_000;

// Everything buildFixation and the engagement scorer need, read once.
const GAZE_PROJECTION = {
  "data.x": 1, "data.y": 1, "data.viewport_x": 1, "data.viewport_y": 1,
  "data.scroll_x": 1, "data.scroll_y": 1,
  "data.element_id": 1, "data.element_key": 1, "data.element_xpath": 1, "data.element_tag": 1,
  "data.element_text": 1, "data.element_alt": 1, "data.element_aria": 1,
  "data.element_src": 1, "data.element_rect": 1,
  timestamp: 1, page_url: 1, page_template: 1,
};

/**
 * Every gaze sample of a session, oldest first.
 *
 * Exported so finalize can read the stream once and hand the same array to
 * derivation and to the engagement scorer, which used to issue this identical
 * query a second time.
 */
export async function loadGazeEvents(sessionId) {
  const gazeEvents = await Event.find(
    { session_id: sessionId, type: "gaze" },
    GAZE_PROJECTION
  )
    .sort({ timestamp: 1 })
    .limit(MAX_GAZE_SAMPLES + 1)
    .lean();

  if (gazeEvents.length > MAX_GAZE_SAMPLES) {
    console.warn(
      `[deriveFixations] session ${sessionId} has more than ${MAX_GAZE_SAMPLES} gaze samples; deriving from the first ${MAX_GAZE_SAMPLES}`
    );
    gazeEvents.length = MAX_GAZE_SAMPLES;
  }
  return gazeEvents;
}

/**
 * Derive this session's fixations and replace whatever was there before.
 *
 * Delete-first is what makes the whole finalize path safe to retry: a finalize
 * that is interrupted part-way (a Spot reclaim, a deploy, a throw) can simply
 * run again without leaving a second copy of every fixation behind. The same
 * shape scripts/relabel-pages.mjs already uses.
 *
 * @param {string} sessionId
 * @param {string} projectId
 * @param {{ gazeEvents?: object[] }} [opts] pre-read samples, to avoid re-querying
 * @returns {Promise<number>} fixations written
 */
export async function deriveFixations(sessionId, projectId, { gazeEvents } = {}) {
  const samples = gazeEvents ?? (await loadGazeEvents(sessionId));
  if (!samples.length) {
    await Fixation.deleteMany({ session_id: sessionId });
    return 0;
  }

  const fixations = clusterFixations(samples, sessionId, projectId);

  await Fixation.deleteMany({ session_id: sessionId });
  if (fixations.length === 0) return 0;

  try {
    await Fixation.insertMany(fixations, { ordered: false });
  } catch (err) {
    // insertMany({ordered:false}) throws on any partial failure. A duplicate
    // key means a concurrent derivation already wrote that fixation, which is
    // the outcome we wanted anyway. Anything else is a real failure and must
    // reach the caller: swallowing it here is what used to report a confident
    // fixation_count for a session that had none.
    const writeErrors = err?.writeErrors ?? [];
    const allDuplicates =
      writeErrors.length > 0 && writeErrors.every((e) => (e.err?.code ?? e.code) === 11000);
    if (!allDuplicates && err?.code !== 11000) throw err;
  }

  return fixations.length;
}
