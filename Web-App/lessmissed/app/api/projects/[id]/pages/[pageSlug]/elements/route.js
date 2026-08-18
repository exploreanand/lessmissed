import { NextResponse } from "next/server";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// GET /api/projects/:id/pages/:pageSlug/elements
// Returns element-level attention: fixation_count, dwell_ms, click_count,
//         looked_not_clicked_rate, attention_to_action_ratio
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, pageSlug } = await params;

  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const totalSessions = await Session.countDocuments({
    project_id: id,
    status: "completed",
    "pages_visited.path": page.path,
  });

  // Aggregate fixations by element_id
  const fixationAgg = await Fixation.aggregate([
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
  ]);

  // Aggregate clicks by element_id
  const clickAgg = await Event.aggregate([
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
  ]);

  const clickMap = {};
  clickAgg.forEach((c) => {
    if (c._id) clickMap[c._id] = { click_count: c.click_count, click_sessions: c.session_ids.length };
  });

  const elements = fixationAgg.map((f) => {
    const elementId = f._id ?? "unknown";
    const clicks = clickMap[elementId] ?? { click_count: 0, click_sessions: 0 };
    const sessions_with_fixation = f.session_ids.length;
    const sessions_with_click = clicks.click_sessions;

    const looked_not_clicked_rate =
      sessions_with_fixation > 0
        ? Math.round(((sessions_with_fixation - sessions_with_click) / sessions_with_fixation) * 100)
        : 0;

    const attention_to_action_ratio =
      sessions_with_click > 0
        ? (sessions_with_fixation / sessions_with_click).toFixed(1)
        : sessions_with_fixation > 0
        ? "∞"
        : "0";

    return {
      element_id: elementId,
      fixation_count: f.fixation_count,
      total_dwell_ms: f.total_dwell_ms,
      avg_dwell_ms: Math.round(f.total_dwell_ms / f.fixation_count),
      click_count: clicks.click_count,
      sessions_with_fixation,
      sessions_with_click,
      looked_not_clicked_rate,
      attention_to_action_ratio,
      // INS-G03: element was never seen
      never_seen: sessions_with_fixation === 0,
    };
  });

  // Also find elements that had clicks but zero fixations (INS-GC02 candidates)
  const clickedNotLooked = [];
  Object.entries(clickMap).forEach(([elementId, c]) => {
    if (!fixationAgg.find((f) => f._id === elementId)) {
      clickedNotLooked.push({
        element_id: elementId,
        fixation_count: 0,
        total_dwell_ms: 0,
        avg_dwell_ms: 0,
        click_count: c.click_count,
        sessions_with_fixation: 0,
        sessions_with_click: c.click_sessions,
        looked_not_clicked_rate: 0,
        attention_to_action_ratio: "0",
        never_seen: false,
        clicked_without_looking: true,
      });
    }
  });

  return NextResponse.json({
    page_path: page.path,
    total_sessions: totalSessions,
    elements: [...elements, ...clickedNotLooked],
  });
}
