import Link from "next/link";
import { notFound } from "next/navigation";
import Session from "@/lib/models/Session";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import { computeFirstFixation } from "@/lib/insights/firstFixation";
import { getOwnedProject } from "@/lib/auth/ownership";
import HeatmapViewer from "./HeatmapViewer";
import InsightCatalog from "./InsightCatalog";

export default async function PageDetailPage({ params }) {
  const { projectId, pageSlug } = await params;

  const project = await getOwnedProject(projectId);
  if (!project) notFound();

  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) notFound();

  // All completed sessions for this project (wildcard page paths make per-page session queries unreliable)
  const sessions = await Session.find({
    project_id: project._id,
    status: "completed",
  }).lean();

  const totalSessions = sessions.length;

  const avgEngagementScore =
    totalSessions > 0
      ? Math.round(sessions.reduce((a, s) => a + (s.engagement_score ?? 0), 0) / totalSessions)
      : 0;

  const scrollDepths = sessions.map((s) => s.summary?.max_scroll_depth_percent ?? 0);
  const avgScrollDepth =
    totalSessions > 0
      ? Math.round(scrollDepths.reduce((a, b) => a + b, 0) / totalSessions)
      : 0;

  const scrollReach = {
    25:  Math.round((scrollDepths.filter((d) => d >= 25).length  / Math.max(1, totalSessions)) * 100),
    50:  Math.round((scrollDepths.filter((d) => d >= 50).length  / Math.max(1, totalSessions)) * 100),
    75:  Math.round((scrollDepths.filter((d) => d >= 75).length  / Math.max(1, totalSessions)) * 100),
    100: Math.round((scrollDepths.filter((d) => d >= 100).length / Math.max(1, totalSessions)) * 100),
  };

  // Element-level data from fixations + clicks for this page's exact path
  const [fixationAgg, clickAgg, firstFixation] = await Promise.all([
    Fixation.aggregate([
      { $match: { project_id: project._id, page_url: page.path } },
      {
        $group: {
          _id: "$element_id",
          fixation_count: { $sum: 1 },
          total_dwell_ms: { $sum: "$duration_ms" },
          session_ids: { $addToSet: "$session_id" },
        },
      },
      { $sort: { fixation_count: -1 } },
    ]),
    Event.aggregate([
      {
        $match: {
          "metadata.project_id": project._id,
          page_url: page.path,
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
  ]);

  const clickMap = {};
  clickAgg.forEach((c) => {
    if (c._id) clickMap[c._id] = { click_count: c.click_count, click_sessions: c.session_ids.length };
  });

  const elements = fixationAgg.map((f) => {
    const elementId = f._id ?? "unknown";
    const clicks = clickMap[elementId] ?? { click_count: 0, click_sessions: 0 };
    const sessionsWithFixation = f.session_ids.length;
    const sessionsWithClick = clicks.click_sessions;
    return {
      element_id: elementId,
      fixation_count: f.fixation_count,
      total_dwell_ms: f.total_dwell_ms,
      avg_dwell_ms: Math.round(f.total_dwell_ms / f.fixation_count),
      click_count: clicks.click_count,
      sessions_with_fixation: sessionsWithFixation,
      sessions_with_click: sessionsWithClick,
      pct: totalSessions > 0 ? Math.round((sessionsWithFixation / totalSessions) * 100) : 0,
    };
  });

  const lookedNotClicked = elements
    .filter((e) => e.sessions_with_fixation > 0 && e.sessions_with_click < e.sessions_with_fixation * 0.5)
    .map((e) => ({
      element_id: e.element_id,
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
    avg_scroll_depth_pct: avgScrollDepth,
    scroll_reach: scrollReach,
    avg_dwell_ms: avgDwellMs,
    // INS-G04
    first_fixation: firstFixation,
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
