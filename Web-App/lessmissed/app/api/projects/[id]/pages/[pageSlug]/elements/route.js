import { NextResponse } from "next/server";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";
import { pageMatchFilter } from "@/lib/pathTemplate";

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

  const pageFilter = pageMatchFilter(page);

  // Sessions are scoped by the visit's template — the key the visits endpoint
  // writes — not by the raw path, which never matched a wildcard page.
  const totalSessions = await Session.countDocuments({
    project_id: id,
    status: "completed",
    "pages_visited.template": page.path,
  });

  // Aggregate fixations by element_id
  const fixationAgg = await Fixation.aggregate([
    { $match: { project_id: project._id, ...pageFilter } },
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
  ]);

  const clickMap = {};
  clickAgg.forEach((c) => {
    // Keep the session ids, not just how many there were: both rates below are
    // defined over sessions that fixated AND clicked, which needs the
    // intersection. Comparing raw counts lets a element clicked by sessions
    // that never fixated it drive looked_not_clicked_rate negative.
    if (c._id) clickMap[c._id] = { click_count: c.click_count, click_session_ids: c.session_ids };
  });

  const elements = fixationAgg.map((f) => {
    const elementId = f._id ?? "unknown";
    const clicks = clickMap[elementId] ?? { click_count: 0, click_session_ids: [] };
    const fixationSessions = new Set(f.session_ids);
    const sessions_with_fixation = fixationSessions.size;
    const sessions_with_click = clicks.click_session_ids.length;
    // S_F ∩ S_C — sessions that both looked at the element and clicked it.
    const sessions_fixated_and_clicked =
      clicks.click_session_ids.filter((id) => fixationSessions.has(id)).length;

    // LBNC(e) = |S_F \ S_C| / |S_F| — the share of sessions that looked and
    // did not act. Bounded to [0, 100] by construction.
    const looked_not_clicked_rate =
      sessions_with_fixation > 0
        ? Math.round(
            ((sessions_with_fixation - sessions_fixated_and_clicked) / sessions_with_fixation) * 100
          )
        : 0;

    // A2A(e) = |S_F| / |S_F ∩ S_C| — looks per action, so that
    // A2A = 1 / (1 - LBNC) holds exactly.
    const attention_to_action_ratio =
      sessions_fixated_and_clicked > 0
        ? (sessions_with_fixation / sessions_fixated_and_clicked).toFixed(1)
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
      sessions_fixated_and_clicked,
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
