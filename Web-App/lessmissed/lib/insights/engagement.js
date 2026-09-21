// Engagement score — SRS §6.2–6.3, implemented as specified.
//
// A 0–100 quality score per session: does this look like a person genuinely
// reading the site, or someone farming a reward? Five signals, each scaled from
// the SRS's "zero marks" to its "full marks", then weighted:
//
//   Fixation diversity        30   ≤ 1 unique element      → ≥ 8
//   Saccade naturalness       25   no saccades / ≤ 1:1     → 3:1 – 5:1 small:large
//   Scroll–gaze correlation   20   Pearson r ≤ 0.2         → r ≥ 0.6
//   Page coverage             15   ≤ 2 of 10 bands         → ≥ 6 bands
//   Interaction signals       10   0 clicks                → ≥ 3 clicks
//
// Until this existed the field was hard-coded to 0 when a session was created
// and never touched again, so every "Avg engagement" figure in the product was a
// placeholder.
//
// Plain relative imports, no "@/" alias, so tests and backfill scripts can load
// it under bare Node — the same constraint as pathTemplate.js.

import Fixation from "../models/Fixation.js";
import Event from "../models/Event.js";
import Project from "../models/Project.js";
import PageCapture from "../models/PageCapture.js";

export const WEIGHTS = {
  fixation_diversity: 0.3,
  saccade_naturalness: 0.25,
  scroll_gaze_correlation: 0.2,
  page_coverage: 0.15,
  interaction_signals: 0.1,
};

// The SRS gives the small:large ratio for a natural saccade pattern but not
// where "small" ends. A third of a 900 px viewport: a jump within the reading
// area is small, a leap across the screen is large. Named so it can be tuned
// without hunting for a magic number.
export const LARGE_SACCADE_PX = 300;

// Fewer paired samples than this and a correlation coefficient is noise.
const MIN_CORRELATION_SAMPLES = 10;

const BANDS = 10;

/** Linear ramp: 0 at `zero`, 100 at `full`, clamped. */
export function ramp(value, zero, full) {
  if (!Number.isFinite(value)) return 0;
  const t = (value - zero) / (full - zero);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

/** Unique elements fixated: ≤ 1 → 0, ≥ 8 → 100. */
export function scoreFixationDiversity(fixations) {
  const keys = new Set(
    fixations.map((f) => f.element_key || f.element_id).filter(Boolean)
  );
  return ramp(keys.size, 1, 8);
}

/**
 * Small:large saccade ratio between consecutive fixations.
 *
 * The SRS table reads "zero marks: 0 saccades OR >1:1 ratio". Taken literally
 * that would zero the healthy 3:1 band as well, so this reads it as the evident
 * intent — at least as many large leaps as small steps, i.e. ratio ≤ 1, is the
 * erratic end. Above 5:1 the spec is silent; a session of almost nothing but
 * tiny steps is a stare rather than reading, so the score tapers to 50 by 10:1
 * rather than staying at full marks.
 */
export function scoreSaccadeNaturalness(fixations) {
  let small = 0;
  let large = 0;

  for (let i = 1; i < fixations.length; i++) {
    const a = fixations[i - 1];
    const b = fixations[i];
    // A saccade does not cross a navigation: the next page's coordinates are a
    // different document.
    if ((a.page_template ?? a.page_url) !== (b.page_template ?? b.page_url)) continue;
    const distance = Math.hypot(b.center_x - a.center_x, b.center_y - a.center_y);
    if (!Number.isFinite(distance)) continue;
    if (distance < LARGE_SACCADE_PX) small++;
    else large++;
  }

  if (small + large === 0) return 0;
  const ratio = large === 0 ? Infinity : small / large;

  if (ratio <= 1) return 0;
  if (ratio < 3) return ramp(ratio, 1, 3);
  if (ratio <= 5) return 100;
  if (ratio === Infinity) return 50;
  return Math.round(100 - Math.min(1, (ratio - 5) / 5) * 50);
}

/** Pearson correlation coefficient; null when it is undefined. */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;

  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }

  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/**
 * Does gaze move through the document as the page scrolls? r ≤ 0.2 → 0,
 * r ≥ 0.6 → 100.
 *
 * Implements the SRS literally: Pearson r of scroll position against gaze
 * document-y. Two honest caveats, both properties of that definition rather
 * than of this code:
 *   - document-y is viewport-y + scroll-y, so part of the correlation is there
 *     by construction; a fixed stare while scrolling also scores well.
 *   - a session that never scrolls has no variance and so no correlation, and
 *     scores 0 here — which penalises genuinely single-screen pages.
 * Worth revisiting against real sessions once there are enough of them.
 */
export function scoreScrollGazeCorrelation(gazeSamples) {
  if (gazeSamples.length < MIN_CORRELATION_SAMPLES) return 0;
  const r = pearson(
    gazeSamples.map((g) => g.scroll_y),
    gazeSamples.map((g) => g.doc_y)
  );
  return r == null ? 0 : ramp(r, 0.2, 0.6);
}

/**
 * Which of the page's ten vertical bands received a fixation?
 *
 * The SRS was written when a session was one page. Sessions now span a site, so
 * coverage is measured per page against that page's own height and averaged
 * over the pages that were actually looked at.
 *
 * @param {Array} fixations
 * @param {Map<string, number>} heights document height per page template
 */
export function scorePageCoverage(fixations, heights = new Map()) {
  const byPage = new Map();
  for (const f of fixations) {
    const key = f.page_template ?? f.page_url ?? "/";
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(f);
  }
  if (!byPage.size) return 0;

  const perPage = [];
  for (const [template, pageFixations] of byPage) {
    const covered = bandsCovered(pageFixations, heights.get(template));
    perPage.push(ramp(covered, 2, 6));
  }
  return Math.round(perPage.reduce((a, b) => a + b, 0) / perPage.length);
}

/**
 * Number of the ten vertical bands containing at least one fixation centre.
 *
 * Without a known document height the observed extent stands in for it — the
 * deepest fixation marks the bottom — which can only overstate coverage, never
 * invent it where no fixation landed.
 */
export function bandsCovered(fixations, documentHeight) {
  const ys = fixations.map((f) => f.center_y).filter(Number.isFinite);
  if (!ys.length) return 0;
  const height = documentHeight > 0 ? documentHeight : Math.max(...ys) + 1;

  const bands = new Set();
  for (const y of ys) {
    bands.add(Math.min(BANDS - 1, Math.max(0, Math.floor((y / height) * BANDS))));
  }
  return bands.size;
}

/** Clicks: 0 → 0, ≥ 3 → 100. */
export function scoreInteraction(clickCount) {
  return ramp(clickCount, 0, 3);
}

/**
 * The full score from already-loaded data. Pure, so it can be tested at the
 * SRS's exact boundaries without a database.
 *
 * @returns {{ score: number, breakdown: Record<string, number> }}
 */
export function scoreEngagement({ fixations = [], gazeSamples = [], clickCount = 0, heights }) {
  const ordered = [...fixations].sort(
    (a, b) => new Date(a.start_timestamp ?? 0) - new Date(b.start_timestamp ?? 0)
  );

  const breakdown = {
    fixation_diversity: scoreFixationDiversity(ordered),
    saccade_naturalness: scoreSaccadeNaturalness(ordered),
    scroll_gaze_correlation: scoreScrollGazeCorrelation(gazeSamples),
    page_coverage: scorePageCoverage(ordered, heights),
    interaction_signals: scoreInteraction(clickCount),
  };

  const score = Object.entries(WEIGHTS).reduce(
    (sum, [key, weight]) => sum + breakdown[key] * weight,
    0
  );

  return { score: Math.round(score), breakdown };
}

/**
 * Load a session's data and score it. Called at finalize, after fixations have
 * been derived, and by the backfill.
 */
export async function computeSessionEngagement(sessionId, projectId) {
  const [fixations, gazeEvents, clickCount, project] = await Promise.all([
    Fixation.find({ session_id: sessionId })
      .select("center_x center_y element_key element_id page_template page_url start_timestamp")
      .lean(),
    Event.find({ session_id: sessionId, type: "gaze" })
      .select("data.y data.scroll_y")
      .lean(),
    Event.countDocuments({ session_id: sessionId, type: "click" }),
    projectId ? Project.findById(projectId).select("pages").lean() : null,
  ]);

  const gazeSamples = gazeEvents
    .map((e) => {
      const y = Number(e.data?.y);
      const scrollY = Number(e.data?.scroll_y ?? 0);
      return Number.isFinite(y) ? { scroll_y: scrollY, doc_y: y + scrollY } : null;
    })
    .filter(Boolean);

  const heights = await documentHeights(project);
  return scoreEngagement({ fixations, gazeSamples, clickCount, heights });
}

/**
 * Document height per page template, from each page's current capture — the
 * same render the heatmap is drawn on, so bands mean the same thing here as
 * they do on screen.
 */
async function documentHeights(project) {
  const heights = new Map();
  const pages = project?.pages ?? [];
  const ids = pages.map((p) => p.current_capture?.desktop).filter(Boolean);
  if (!ids.length) return heights;

  const captures = await PageCapture.find({ _id: { $in: ids } })
    .select("captured_height document_height")
    .lean();
  const byId = new Map(captures.map((c) => [String(c._id), c]));

  for (const page of pages) {
    const capture = byId.get(String(page.current_capture?.desktop));
    const height = capture?.captured_height ?? capture?.document_height;
    if (height > 0) heights.set(page.path, height);
  }
  return heights;
}
