import { NextResponse } from "next/server";
import Session from "@/lib/models/Session";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import { computeFirstFixation } from "@/lib/insights/firstFixation";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";
import { pageMatchFilter } from "@/lib/pathTemplate";

// GET /api/projects/:id/pages/:pageSlug/insights
// Returns all Phase 1 computed insights for a page
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, pageSlug } = await params;

  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const pageFilter = pageMatchFilter(page);

  // Scoped on the visit template, which the visits endpoint keys to this page —
  // "pages_visited.path" holds raw URLs and so never matched a wildcard page.
  const [acceptedSessions, allSessions] = await Promise.all([
    Session.find({
      project_id: project._id,
      status: "completed",
      "pages_visited.template": page.path,
    }).lean(),
    Session.find({ project_id: project._id, "pages_visited.template": page.path }).lean(),
  ]);

  const totalSessions = acceptedSessions.length;
  const totalAllSessions = allSessions.length;

  // INS-SL04: Engagement score distribution
  const engagementScores = acceptedSessions.map((s) => s.engagement_score);
  const avgEngagement =
    engagementScores.length > 0
      ? Math.round(engagementScores.reduce((a, b) => a + b, 0) / engagementScores.length)
      : 0;

  // INS-S01: Scroll depth
  const scrollDepths = acceptedSessions.map((s) => s.summary?.max_scroll_depth_percent ?? 0);
  const avgScrollDepth =
    scrollDepths.length > 0
      ? Math.round(scrollDepths.reduce((a, b) => a + b, 0) / scrollDepths.length)
      : 0;

  // Quality gate %
  const quality_pass_rate =
    totalAllSessions > 0 ? Math.round((totalSessions / totalAllSessions) * 100) : 0;

  // INS-G03: Missed elements — elements with zero fixations
  const allElements = await Fixation.distinct("element_id", {
    project_id: project._id,
    ...pageFilter,
  });

  // INS-G04: First fixation point
  const firstFixation = await computeFirstFixation(project, page);

  // Rage + dead clicks from session summaries
  const totalRageClicks = acceptedSessions.reduce((a, s) => a + (s.summary?.rage_clicks ?? 0), 0);
  const totalDeadClicks = acceptedSessions.reduce((a, s) => a + (s.summary?.dead_clicks ?? 0), 0);
  const totalScrollBacks = acceptedSessions.reduce((a, s) => a + (s.summary?.scroll_backs ?? 0), 0);
  const avgConfusionScore =
    acceptedSessions.length > 0
      ? Math.round(
          acceptedSessions.reduce((a, s) => a + (s.summary?.confusion_score ?? 0), 0) /
            acceptedSessions.length
        )
      : 0;

  // INS-GC01: Looked but didn't click — aggregate across fixations and clicks
  const fixationElementCounts = await Fixation.aggregate([
    { $match: { project_id: project._id, ...pageFilter } },
    { $group: { _id: "$element_id", sessions: { $addToSet: "$session_id" } } },
  ]);

  const clickElementCounts = await Event.aggregate([
    {
      $match: {
        "metadata.project_id": project._id,
        ...pageFilter,
        type: "click",
      },
    },
    { $group: { _id: "$data.element_id", sessions: { $addToSet: "$session_id" } } },
  ]);

  // Session ids, not counts: LBNC is defined over sessions that fixated AND
  // clicked, so the intersection is required. Comparing bare counts lets an
  // element clicked by sessions that never fixated it look better than it is.
  const clickMap = {};
  clickElementCounts.forEach((c) => c._id && (clickMap[c._id] = new Set(c.sessions)));

  const bothCount = (f) => {
    const clicked = clickMap[f._id];
    return clicked ? f.sessions.filter((id) => clicked.has(id)).length : 0;
  };

  const lookedNotClicked = fixationElementCounts
    .filter((f) => {
      const fixedSessions = f.sessions.length;
      // LBNC(e) > 0.5 — more than half the sessions that looked did not act.
      return fixedSessions > 0 && bothCount(f) < fixedSessions * 0.5;
    })
    .map((f) => ({
      element_id: f._id,
      pct_looked: Math.round((f.sessions.length / totalSessions) * 100),
      pct_clicked: Math.round((bothCount(f) / totalSessions) * 100),
      lbnc_pct: Math.round(((f.sessions.length - bothCount(f)) / f.sessions.length) * 100),
    }))
    .sort((a, b) => b.pct_looked - a.pct_looked)
    .slice(0, 5);

  return NextResponse.json({
    page_path: page.path,
    total_sessions: totalSessions,
    quality_pass_rate,
    insights: {
      // INS-SL04
      avg_engagement_score: avgEngagement,
      // INS-S01
      avg_scroll_depth_pct: avgScrollDepth,
      // INS-GC01
      looked_not_clicked: lookedNotClicked,
      // INS-G03
      total_unique_elements_seen: allElements.length,
      // INS-G04
      first_fixation: firstFixation,
      // Aggregate click signals
      total_rage_clicks: totalRageClicks,
      total_dead_clicks: totalDeadClicks,
      total_scroll_backs: totalScrollBacks,
      avg_confusion_score: avgConfusionScore,
    },
  });
}
