import Link from "next/link";
import { notFound } from "next/navigation";
import Session from "@/lib/models/Session";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import { computeFirstFixation } from "@/lib/insights/firstFixation";
import { computeScanPath } from "@/lib/insights/scanPath";
import { computeAttentionDropOff } from "@/lib/insights/attentionDropOff";
import { computeBacktracking } from "@/lib/insights/backtracking";
import { computeScrollDepth } from "@/lib/insights/scrollDepth";
import { computeScrollVelocity } from "@/lib/insights/scrollVelocity";
import { computeScrollBack } from "@/lib/insights/scrollBack";
import { computeFoldAwareness } from "@/lib/insights/foldAwareness";
import { computeRageClicks } from "@/lib/insights/rageClicks";
import { computeDeadClicks } from "@/lib/insights/deadClicks";
import { computeLastClickBeforeExit } from "@/lib/insights/lastClickBeforeExit";
import { computeClickedWithoutLooking } from "@/lib/insights/clickedWithoutLooking";
import { describeElement, isInstrumentElement } from "@/lib/insights/describeElement";
import { getOwnedProject } from "@/lib/auth/ownership";
import { pageMatchFilter } from "@/lib/pathTemplate";
import HeatmapViewer from "./HeatmapViewer";
import InsightCatalog from "./InsightCatalog";

function medianOf(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export default async function PageDetailPage({ params }) {
  const { projectId, pageSlug } = await params;

  const project = await getOwnedProject(projectId);
  if (!project) notFound();

  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) notFound();

  // Completed sessions that actually reached this page. This used to be every
  // session in the project — per-page scoping was impossible while a wildcard
  // page path could not be matched against a raw visit path. Each visit now
  // carries the template it resolved to, so the count means what it says.
  const sessions = await Session.find({
    project_id: project._id,
    status: "completed",
    "pages_visited.template": page.path,
  }).lean();

  const totalSessions = sessions.length;
  const pageFilter = pageMatchFilter(page);

  const avgEngagementScore =
    totalSessions > 0
      ? Math.round(sessions.reduce((a, s) => a + (s.engagement_score ?? 0), 0) / totalSessions)
      : 0;

  // Element-level data from fixations + clicks for this page's exact path
  const [fixationAgg, clickAgg, firstFixation, scanPath, attentionDropOff, backtracking, scrollDepth, scrollVelocity, scrollBack, foldAwareness, rageClicks, deadClicks, lastClickBeforeExit, clickedWithoutLooking] = await Promise.all([
    // Group by screenshot region, falling back to the raw selector for
    // fixations derived before the page was labelled. Grouping by region is
    // what separates components that share one selector — on a commerce page a
    // single "img.image-image" covers the hero, the promo strip and every
    // category tile.
    Fixation.aggregate([
      { $match: { project_id: project._id, ...pageFilter } },
      {
        $group: {
          // region → positional key → selector. The middle rung matters for
          // sessions recorded before the page was labelled: element_id alone
          // merges every unclassed <p> into one row.
          _id: { $ifNull: ["$region_id", { $ifNull: ["$element_key", "$element_id"] }] },
          fixation_count: { $sum: 1 },
          total_dwell_ms: { $sum: "$duration_ms" },
          // INS-G05 needs per-fixation durations to compute the median. $sum
          // alone can't do it, and Mongo $percentile is 7.0+ only.
          durations: { $push: "$duration_ms" },
          session_ids: { $addToSet: "$session_id" },
          element_id: { $first: "$element_id" },
          element_tag: { $first: "$element_tag" },
          element_text: { $first: "$element_text" },
          element_alt: { $first: "$element_alt" },
          element_aria: { $first: "$element_aria" },
          element_src: { $first: "$element_src" },
        },
      },
      { $sort: { fixation_count: -1 } },
    ]),
    Event.aggregate([
      {
        $match: {
          "metadata.project_id": project._id,
          ...pageFilter,
          type: "click",
        },
      },
      {
        $group: {
          _id: "$data.element_id",
          click_count: { $sum: 1 },
          session_ids: { $addToSet: "$session_id" },
        },
      },
    ]),
    // INS-G04: first 200ms+ fixation per session, aggregated into first-look regions
    computeFirstFixation(project, page),
    // INS-G06: ordered scan path across sessions — top transitions and modal opening
    computeScanPath(project, page),
    // INS-G08: vertical attention drop-off point and the scroll-vs-look gap
    computeAttentionDropOff(project, page),
    // INS-G07: revisits per element — sessions that returned to an element after moving away
    computeBacktracking(project, page),
    // INS-S01: max scroll depth per session — avg/median headline, quartile reach, decile distribution
    computeScrollDepth(project, page),
    // INS-S02: per-decile scroll velocity — skim vs read classification
    computeScrollVelocity(project, page),
    // INS-S03: scroll-back events attributed to the destination decile
    computeScrollBack(project, page),
    // INS-S04: element-level net visibility — scroll reach × fixation, below the fold
    computeFoldAwareness(project, page),
    // INS-C02: rage-click bursts attributed to the clicked element
    computeRageClicks(project, page),
    // INS-C03: dead clicks — clicks on non-interactive elements
    computeDeadClicks(project, page),
    // INS-C04: last click on this page for sessions that exited here without completing the task
    computeLastClickBeforeExit(project, page),
    // INS-GC02: muscle-memory clicks — clicks on elements with no prior fixation in the session
    computeClickedWithoutLooking(project, page),
  ]);

  const clickMap = {};
  clickAgg.forEach((c) => {
    if (c._id) clickMap[c._id] = { click_count: c.click_count, click_sessions: c.session_ids.length };
  });

  // Region labels come from the stored map; anything unlabelled falls back to
  // the best description we can build from the DOM fields on the fixation.
  const regionById = new Map((page.regions ?? []).map((r) => [r.region_id, r]));

  const elements = fixationAgg
    // Drop our own gaze-dot overlay: it is instrumentation, not the site.
    .filter((f) => regionById.has(f._id) || !isInstrumentElement(f.element_id))
    .map((f) => {
      const elementId = f.element_id ?? f._id ?? "unknown";
      const region = regionById.get(f._id);
      const described = describeElement(f);
      const clicks = clickMap[elementId] ?? { click_count: 0, click_sessions: 0 };
      const sessionsWithFixation = f.session_ids.length;
      const sessionsWithClick = clicks.click_sessions;
      return {
        // The $group id — region, positional key, or selector. Unique per row,
        // unlike element_id, which many regions now deliberately share.
        key: f._id,
        element_id: elementId,
        label: region?.label ?? described.label,
        category: region?.category ?? null,
        label_source: region?.source ?? described.source,
        fixation_count: f.fixation_count,
        total_dwell_ms: f.total_dwell_ms,
        avg_dwell_ms: Math.round(f.total_dwell_ms / f.fixation_count),
        median_dwell_ms: medianOf(f.durations ?? []),
        click_count: clicks.click_count,
        sessions_with_fixation: sessionsWithFixation,
        sessions_with_click: sessionsWithClick,
        pct: totalSessions > 0 ? Math.round((sessionsWithFixation / totalSessions) * 100) : 0,
      };
    });

  const lookedNotClicked = elements
    .filter((e) => e.sessions_with_fixation > 0 && e.sessions_with_click < e.sessions_with_fixation * 0.5)
    .map((e) => ({
      key: e.key,
      element_id: e.element_id,
      label: e.label,
      pct_looked: e.pct,
      pct_clicked: totalSessions > 0 ? Math.round((e.sessions_with_click / totalSessions) * 100) : 0,
    }))
    .slice(0, 5);

  const avgDwellMs =
    elements.length > 0
      ? Math.round(elements.reduce((a, e) => a + e.avg_dwell_ms, 0) / elements.length)
      : 0;

  const insights = {
    total_sessions: totalSessions,
    avg_engagement_score: avgEngagementScore,
    avg_dwell_ms: avgDwellMs,
    // INS-G04
    first_fixation: firstFixation,
    // INS-G06
    scan_path: scanPath,
    // INS-G07
    backtracking,
    // INS-G08
    attention_drop_off: attentionDropOff,
    // INS-S01
    scroll_depth: scrollDepth,
    // INS-S02
    scroll_velocity: scrollVelocity,
    // INS-S03
    scroll_back: scrollBack,
    // INS-S04
    fold_awareness: foldAwareness,
    // INS-C02
    rage_clicks: rageClicks,
    // INS-C03
    dead_clicks: deadClicks,
    // INS-C04
    last_click_before_exit: lastClickBeforeExit,
    // INS-GC02
    clicked_without_looking: clickedWithoutLooking,
    looked_not_clicked: lookedNotClicked,
    total_unique_elements_seen: fixationAgg.length,
    total_rage_clicks:   sessions.reduce((a, s) => a + (s.summary?.rage_clicks    ?? 0), 0),
    total_dead_clicks:   sessions.reduce((a, s) => a + (s.summary?.dead_clicks    ?? 0), 0),
    total_scroll_backs:  sessions.reduce((a, s) => a + (s.summary?.scroll_backs   ?? 0), 0),
  };

  const firstSessionId = sessions[0]?.session_id ?? null;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{page.path}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {totalSessions} sessions analyzed
          </p>
        </div>
        {firstSessionId && (
          <Link
            href={`/dashboard/projects/${projectId}/sessions/${firstSessionId}`}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:border-violet-400 dark:hover:border-violet-600 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
            </svg>
            View replays
          </Link>
        )}
      </div>

      {/* Heatmap viewer */}
      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Heatmap Viewer</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Switch modes to explore Gaze · Click · Scroll · Cursor overlays
          </p>
        </div>
        <HeatmapViewer projectId={projectId} pageSlug={pageSlug} />
      </section>

      {/* Insight Engine */}
      <section>
        <InsightCatalog
          projectId={projectId}
          insights={insights}
          elements={elements}
        />
      </section>
    </div>
  );
}
