import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import { deriveFixations } from "@/lib/deriveFixations";

// Allow up to 60 seconds for fixation derivation on large sessions
export const maxDuration = 60;

// PATCH /api/extension/sessions/:id
// Body: { ended_at, pages_visited?, max_scroll_depth_pct? }
// Finalises the session and runs server-side fixation derivation (I-DT algorithm).
export async function PATCH(request, { params }) {
  await connectDB();

  const { id: session_id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { ended_at, pages_visited, max_scroll_depth_pct } = body;

  const session = await Session.findOne({ session_id }).lean();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "completed") {
    return NextResponse.json({ ok: true, already_finalized: true });
  }

  const endedAt = new Date(ended_at ?? Date.now());
  const durationMs = endedAt - new Date(session.started_at);

  const update = {
    status: "completed",
    ended_at: endedAt,
    duration_ms: Math.max(0, durationMs),
  };

  if (pages_visited) update.pages_visited = pages_visited;
  if (max_scroll_depth_pct != null) {
    update["summary.max_scroll_depth_percent"] = max_scroll_depth_pct;
  }

  await Session.updateOne({ session_id }, { $set: update });

  // Update page-level session_count and last_session_at for each visited page
  const visitedPaths = (update.pages_visited ?? session.pages_visited ?? []).map((p) => p.path);
  const uniquePaths = [...new Set(visitedPaths)];
  if (uniquePaths.length > 0) {
    await Promise.all(
      uniquePaths.map((path) =>
        Project.updateOne(
          { _id: session.project_id, "pages.path": path },
          {
            $inc: { "pages.$.session_count": 1 },
            $set: { "pages.$.last_session_at": endedAt },
          }
        )
      )
    );
  }

  // Derive fixations from raw gaze events — I-DT algorithm
  let fixation_count = 0;
  try {
    fixation_count = await deriveFixations(session_id, session.project_id.toString());
  } catch (err) {
    // Non-fatal: fixations can be re-derived later
    console.error("[deriveFixations] failed for session", session_id, err.message);
  }

  return NextResponse.json({ ok: true, fixation_count });
}
