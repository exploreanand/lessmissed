import Session from "@/lib/models/Session";

// INS-S01: Scroll Depth — the maximum vertical fraction of a page each session
// reached, aggregated across sessions. SRS §7.2.
//
// This is the "how far down did users get" question, cleanly separated from
// "did they look at what was there" (INS-G08). max_scroll_depth_percent on a
// session summary is the deepest point the viewport bottom touched, so a
// session that scrolled to 50% saw everything down to the 50% document mark.

const REACH_MARKS = [25, 50, 75, 100];
const DECILE_COUNT = 10;

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

function emptyResult() {
  return {
    total_sessions: 0,
    avg_scroll_depth_pct: 0,
    median_scroll_depth_pct: 0,
    max_scroll_depth_pct: 0,
    reach: Object.fromEntries(REACH_MARKS.map((m) => [m, 0])),
    reach_bands: Array.from({ length: DECILE_COUNT }, (_, i) => ({
      index: i,
      label: `${i * 10}-${(i + 1) * 10}%`,
      session_count: 0,
      pct: 0,
    })),
  };
}

// Takes the lean project doc and page subdoc. Fetches only the summary field
// that matters — summary.max_scroll_depth_percent — to keep the projection
// small on pages with tens of thousands of sessions.
export async function computeScrollDepth(project, page) {
  // Same scoping rule as every other page-level insight (G04/G06/G07/G08).
  // "completed" excludes rejected sessions; the visit template match excludes
  // sessions that never reached this page.
  const sessions = await Session.find(
    {
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    },
    { "summary.max_scroll_depth_percent": 1 }
  ).lean();

  const totalSessions = sessions.length;
  if (totalSessions === 0) return emptyResult();

  // Depths are 0-100 already. Coerce null/undefined to 0 — a session with no
  // scroll data behaves like one that didn't scroll, which is the honest read.
  const depths = sessions.map((s) => s.summary?.max_scroll_depth_percent ?? 0);

  // Classic quartile reach — the 25/50/75/100 marker card that shipped from
  // day one. Kept as-is for anything downstream that reads the shape.
  const reach = {};
  for (const mark of REACH_MARKS) {
    const hit = depths.filter((d) => d >= mark).length;
    reach[mark] = Math.round((hit / totalSessions) * 100);
  }

  // Full distribution: which decile did each session end in? Used by the
  // histogram in the card and answers "where did users stop?" — a question
  // the quartile ladder alone cannot answer, because reaching 30% and 45%
  // look the same at the quartile grain.
  const bands = Array.from({ length: DECILE_COUNT }, (_, i) => ({
    index: i,
    label: `${i * 10}-${(i + 1) * 10}%`,
    session_count: 0,
    pct: 0,
  }));
  for (const d of depths) {
    // A session with max_scroll = 100 lands in the last band (index 9), not a
    // ghost 10th one. Sessions with 0 depth (never scrolled) land in band 0
    // — the "bounced at the fold" cohort, which is meaningful signal.
    const idx = Math.min(DECILE_COUNT - 1, Math.max(0, Math.floor(d / 10)));
    bands[idx].session_count += 1;
  }
  bands.forEach((b) => {
    b.pct = Math.round((b.session_count / totalSessions) * 100);
  });

  return {
    total_sessions: totalSessions,
    avg_scroll_depth_pct: avg(depths),
    median_scroll_depth_pct: median(depths),
    // Rounded already by the summary path, but kept explicit so the shape is
    // documented at the boundary.
    max_scroll_depth_pct: Math.round(Math.max(...depths, 0)),
    reach,
    reach_bands: bands,
  };
}
