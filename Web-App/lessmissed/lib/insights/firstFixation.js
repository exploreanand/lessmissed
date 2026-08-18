import Fixation from "@/lib/models/Fixation";
import Session from "@/lib/models/Session";

// INS-G04: First Fixation Point — the first 200ms+ fixation per session on a page,
// aggregated to find the most common first-look region. SRS §7.1.
//
// 200ms ≈ 3 gaze samples at the extension's 10fps capture rate, so the threshold is
// inclusive — a 3-sample cluster must qualify. deriveFixations() stores everything
// down to 150ms, so 200ms+ fixations are already a strict subset of the collection.
const MIN_FIRST_FIXATION_MS = 200;

const GRID_COLS = 3;
const GRID_ROWS = 3;

const REGION_LABELS = [
  "Top left",    "Top center",    "Top right",
  "Middle left", "Center",        "Middle right",
  "Bottom left", "Bottom center", "Bottom right",
];

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
}

function emptyResult(totalSessions) {
  return {
    total_sessions: totalSessions,
    sessions_with_first_fixation: 0,
    top_elements: [],
    top_region: null,
    regions: [],
    region_basis: null,
    below_fold_pct: null,
    median_time_to_first_ms: 0,
    avg_time_to_first_ms: 0,
    markers: [],
  };
}

// Takes the lean project doc and the page subdoc — not ids. Fixation.aggregate does
// not schema-cast its $match, so project._id must already be an ObjectId, and the
// page subdoc carries the screenshot dimensions the grid math needs.
export async function computeFirstFixation(project, page) {
  // Session query is deliberately NOT filtered by "pages_visited.path" — same reason
  // as pages/[pageSlug]/page.jsx: wildcard page paths make per-page session queries
  // unreliable, and this keeps total_sessions consistent with the sibling cards.
  const sessions = await Session.find(
    { project_id: project._id, status: "completed" },
    { session_id: 1, pages_visited: 1, started_at: 1 }
  ).lean();

  const totalSessions = sessions.length;

  const firsts = await Fixation.aggregate([
    {
      $match: {
        project_id: project._id,
        page_url: page.path,
        duration_ms: { $gte: MIN_FIRST_FIXATION_MS },
      },
    },
    { $sort: { session_id: 1, start_timestamp: 1 } },
    {
      $group: {
        _id: "$session_id",
        element_id:      { $first: "$element_id" },
        center_x:        { $first: "$center_x" },
        center_y:        { $first: "$center_y" },
        duration_ms:     { $first: "$duration_ms" },
        start_timestamp: { $first: "$start_timestamp" },
      },
    },
  ]);

  // Short-circuit before the observed-bounds fallback below — Math.max(...[]) is -Infinity
  if (!firsts.length) return emptyResult(totalSessions);

  // Page entry time per session, used only for time-to-first-fixation. Re-entries
  // collapse into the first visit — INS-G04 is one first look per session, not per visit.
  // pages_visited is only reliably populated for the session's entry page, so the
  // started_at fallback makes this exact for entry pages and approximate elsewhere.
  const enteredAt = {};
  for (const s of sessions) {
    const visits = (s.pages_visited ?? [])
      .filter((v) => v.path === page.path && v.entered_at)
      .map((v) => new Date(v.entered_at).getTime());
    enteredAt[s.session_id] = visits.length
      ? Math.min(...visits)
      : new Date(s.started_at).getTime();
  }

  // Spatial basis. center_x/center_y are absolute document px from heterogeneous
  // viewports; we adopt the exact assumption the gaze heatmap already makes — that all
  // sessions share the screenshot's viewport width / document height. Any other model
  // would put this region rect out of alignment with the heatmap on the same screenshot.
  const vpW  = page.screenshot_viewport_width  || null;
  const fold = page.screenshot_viewport_height || null;
  const docH = page.screenshot_document_height || null;

  const hasScreenshotDims = Boolean(vpW && fold);
  const canOverlay = Boolean(hasScreenshotDims && docH);

  // The grid covers the first viewport, not the full document: pages run 3000px+, so a
  // full-page 3×3 drops ~95% of first looks into the top row and says nothing.
  let gridW = vpW;
  let gridH = fold;
  if (!hasScreenshotDims) {
    // No screenshot captured yet — normalise to the observed bounding box so the card
    // still renders. Approximate, and never used for the pixel overlay.
    gridW = Math.max(...firsts.map((f) => f.center_x), 1);
    gridH = Math.max(...firsts.map((f) => f.center_y), 1);
  }
  const regionBasis = hasScreenshotDims ? "screenshot" : "observed";

  const cells = Array.from({ length: GRID_COLS * GRID_ROWS }, (_, i) => ({
    index: i,
    label: REGION_LABELS[i],
    session_count: 0,
    pct: 0,
  }));

  const elementCounts = {};
  const times = [];
  const markers = [];
  let belowFold = 0;

  for (const f of firsts) {
    const elementId = f.element_id ?? "unknown";
    elementCounts[elementId] = (elementCounts[elementId] ?? 0) + 1;

    const entry = enteredAt[f._id];
    const timeToFirst =
      entry != null ? new Date(f.start_timestamp).getTime() - entry : null;
    // Drop clock-skew negatives from the timing stats only — the fixation still counts
    // toward the region and element distributions.
    const validTime = Number.isFinite(timeToFirst) && timeToFirst >= 0 ? timeToFirst : null;
    if (validTime != null) times.push(validTime);

    if (hasScreenshotDims && f.center_y >= gridH) {
      belowFold++;
    } else {
      const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((f.center_x / gridW) * GRID_COLS)));
      const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((f.center_y / gridH) * GRID_ROWS)));
      cells[row * GRID_COLS + col].session_count++;
    }

    markers.push({
      session_id: f._id,
      x: f.center_x,
      y: f.center_y,
      element_id: elementId,
      duration_ms: f.duration_ms,
      time_to_first_ms: validTime,
      ...(canOverlay
        ? { x_pct: (f.center_x / vpW) * 100, y_pct: (f.center_y / docH) * 100 }
        : {}),
    });
  }

  const withFirstFixation = firsts.length;

  // Percentages are a share of first looks, not of all sessions — dividing by
  // total_sessions would make the nine cells sum to well under 100% and read as a bug.
  const pctOf = (n) => Math.round((n / withFirstFixation) * 100);

  cells.forEach((c) => {
    c.pct = pctOf(c.session_count);
  });

  const topCell = [...cells].sort((a, b) => b.session_count - a.session_count)[0];
  const topRegion =
    topCell && topCell.session_count > 0
      ? {
          ...topCell,
          ...(canOverlay
            ? {
                x_pct: ((topCell.index % GRID_COLS) / GRID_COLS) * 100,
                w_pct: 100 / GRID_COLS,
                y_pct: (Math.floor(topCell.index / GRID_COLS) / GRID_ROWS) * (fold / docH) * 100,
                h_pct: (1 / GRID_ROWS) * (fold / docH) * 100,
              }
            : {}),
        }
      : null;

  const topElements = Object.entries(elementCounts)
    .map(([element_id, session_count]) => ({
      element_id,
      session_count,
      pct: pctOf(session_count),
    }))
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 5);

  return {
    total_sessions: totalSessions,
    sessions_with_first_fixation: withFirstFixation,
    top_elements: topElements,
    top_region: topRegion,
    regions: cells,
    region_basis: regionBasis,
    below_fold_pct: hasScreenshotDims ? pctOf(belowFold) : null,
    median_time_to_first_ms: median(times),
    avg_time_to_first_ms: avg(times),
    markers,
  };
}
