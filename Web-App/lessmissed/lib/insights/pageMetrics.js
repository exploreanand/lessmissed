// Per-page metrics, computed from source data every time they are asked for.
//
// These replace four fields on the page subdocument — avg_fixation_per_session,
// missed_elements_pct, health_score — that the schema described as "cached
// insight metrics (updated by aggregation jobs)". No such job was ever written,
// so every one of them read 0 on every page of every project, and the red 0
// health badge told admins each page was failing. Nothing here is cached: a
// cache with no writer is precisely what produced those permanent zeros, and
// the volumes involved are small. Add one only if this measures slow.
//
// A value that cannot be computed is null, and the UI shows "—". A metric is
// never reported as 0 because its inputs are missing.
//
// Relative imports, no "@/" alias, so tests and scripts can load it.

import Fixation from "../models/Fixation.js";
import Session from "../models/Session.js";
import PageCapture from "../models/PageCapture.js";
import { pageMatchFilter } from "../pathTemplate.js";
import { bandsCovered } from "./engagement.js";

const BANDS = 10;

// Health weights — NOT from the spec. The SRS names a 0–100 health score and
// shows it in the UI but never defines it, so this is a proposal, built only
// from the quantities displayed beside it so it cannot drift from them:
//   how much of the page was seen, how genuinely it was read, how far down
//   attention reached.
export const HEALTH_WEIGHTS = {
  coverage: 0.5, // 100 − missed %
  engagement: 0.3, // average session engagement (SRS §6)
  reach: 0.2, // share of the page's vertical bands that were looked at
};

// Below this many sessions, health is withheld rather than shown. Missed % is
// half its weight, and one short visit cannot look at a 126-element page — so
// on a single session health measures how little data there is, not how good
// the page is, and every page reads as a red failure. Missed % itself is still
// shown: "121 of 126 not looked at yet" is a plain fact. Health is an
// interpretation, and one visit is not enough to interpret. Not from the spec;
// a proposal alongside the formula above.
export const MIN_SESSIONS_FOR_HEALTH = 3;

/** Is a fixation centre inside a box? Edges count as inside. */
export function containsPoint(bbox, x, y) {
  if (!bbox || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= bbox.x && x <= bbox.x + bbox.w && y >= bbox.y && y <= bbox.y + bbox.h;
}

/**
 * INS-G03 — elements on the page that no fixation landed on.
 *
 * Matched by geometry, not selector: a fixation "sees" an element if its centre
 * falls inside the element's box. Selector matching breaks every time a site
 * renames a class; geometry only needs the fixation and the inventory to share
 * a coordinate frame, which they do — both are document CSS pixels, and the
 * inventory comes from the same render as the screenshot the heatmap is drawn on.
 *
 * @returns {{ missed: number, total: number, pct: number } | null}
 *   null when there is no inventory to measure against.
 */
export function computeMissed(inventory, fixations) {
  if (!Array.isArray(inventory) || !inventory.length) return null;

  let missed = 0;
  for (const element of inventory) {
    const seen = fixations.some((f) => containsPoint(element.bbox, f.center_x, f.center_y));
    if (!seen) missed++;
  }

  return {
    missed,
    total: inventory.length,
    pct: Math.round((missed / inventory.length) * 100),
  };
}

/** Share of the page's ten vertical bands with at least one fixation, 0–100. */
export function computeReach(fixations, documentHeight) {
  if (!fixations.length) return null;
  return Math.round((bandsCovered(fixations, documentHeight) / BANDS) * 100);
}

/**
 * Health, 0–100, or null if any input is unavailable. A partial score would
 * silently re-weight itself and stop meaning the same thing from page to page.
 */
export function computeHealth({ missedPct, avgEngagement, reach, sessionCount = Infinity }) {
  if (missedPct == null || avgEngagement == null || reach == null) return null;
  if (sessionCount < MIN_SESSIONS_FOR_HEALTH) return null;
  const value =
    HEALTH_WEIGHTS.coverage * (100 - missedPct) +
    HEALTH_WEIGHTS.engagement * avgEngagement +
    HEALTH_WEIGHTS.reach * reach;
  return Math.round(Math.max(0, Math.min(100, value)));
}

/**
 * Everything the page list shows, from already-loaded data. Pure, for tests.
 */
export function computePageMetrics({
  fixations = [],
  sessionScores = [],
  inventory = null,
  documentHeight = null,
}) {
  const durations = fixations.map((f) => f.duration_ms).filter(Number.isFinite);
  const avgFixationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const scores = sessionScores.filter(Number.isFinite);
  const avgEngagement = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  const missed = computeMissed(inventory, fixations);
  const reach = computeReach(fixations, documentHeight);
  const health = computeHealth({
    missedPct: missed?.pct ?? null,
    avgEngagement,
    reach,
    sessionCount: scores.length,
  });

  // Why health is blank, so the UI can say the useful thing rather than just "—".
  const healthPending =
    health != null ? null
    : !inventory?.length ? "needs_preview"
    : scores.length < MIN_SESSIONS_FOR_HEALTH ? "needs_sessions"
    : "needs_data";

  return {
    fixation_count: fixations.length,
    avg_fixation_ms: avgFixationMs,
    avg_engagement: avgEngagement,
    missed_pct: missed?.pct ?? null,
    missed_count: missed?.missed ?? null,
    inventory_count: missed?.total ?? null,
    attention_reach: reach,
    health,
    health_pending: healthPending,
    sessions_for_health: MIN_SESSIONS_FOR_HEALTH,
  };
}

/**
 * Load and compute metrics for one page.
 *
 * Sessions are scoped the way every other per-page view scopes them — by the
 * template each visit resolved to — and fixations by pageMatchFilter.
 */
export async function loadPageMetrics(project, page) {
  const captureId = page.current_capture?.desktop;

  const [fixations, sessions, capture] = await Promise.all([
    Fixation.find({ project_id: project._id, ...pageMatchFilter(page) })
      .select("center_x center_y duration_ms")
      .lean(),
    Session.find({
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    })
      .select("engagement_score")
      .lean(),
    captureId
      ? PageCapture.findById(captureId).select("elements captured_height document_height").lean()
      : null,
  ]);

  return computePageMetrics({
    fixations,
    sessionScores: sessions.map((s) => s.engagement_score),
    inventory: capture?.elements ?? null,
    documentHeight: capture?.captured_height ?? capture?.document_height ?? null,
  });
}

/** Metrics for many pages at once, keyed by page id. */
export async function loadMetricsForPages(project, pages) {
  const results = await Promise.all(pages.map((page) => loadPageMetrics(project, page)));
  return new Map(pages.map((page, i) => [String(page._id), results[i]]));
}
