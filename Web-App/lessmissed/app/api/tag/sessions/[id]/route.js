import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import { handleTagPreflight, authenticateTagRequest, jsonWithCors } from "@/lib/tag/cors";
import {
  applyPagesVisitedUpdate,
  backfillMissingTemplates,
  finalizeSessionAndRollup,
} from "@/lib/sessions/finalizeSession";

// PATCH /api/tag/sessions/:id
// Body: { ended_at?, pages_visited?, max_scroll_depth_pct? }
//
// With `ended_at` this finalizes the session (closes visits, derives
// fixations, computes engagement, rolls counters up onto Project.pages).
// Without it, this is a partial checkpoint — the tag uses that during a long
// session to sync its accumulated journey to the server.
//
// Shares the finalize path with /api/extension/sessions/[id] via
// lib/sessions/finalizeSession.js — do not duplicate the engagement/rollup
// logic here.

// Fixation derivation on a long session can take tens of seconds — same
// budget as the extension route.
export const maxDuration = 60;

export const OPTIONS = handleTagPreflight;

export async function PATCH(request, { params }) {
  const auth = await authenticateTagRequest(request);
  if (!auth.ok) return auth.response;
  const { project, cors } = auth;

  await connectDB();

  const { id: session_id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ error: "Invalid JSON" }, 400, cors);
  }

  const { ended_at, pages_visited, max_scroll_depth_pct } = body;

  const session = await Session.findOne({ session_id });
  if (!session) return jsonWithCors({ error: "Session not found" }, 404, cors);
  // Same guard as the events route — key from one project must not touch
  // another project's session.
  if (session.project_id.toString() !== project._id.toString()) {
    return jsonWithCors({ error: "Session belongs to a different project" }, 403, cors);
  }
  if (session.status === "completed") {
    return jsonWithCors({ ok: true, already_finalized: true }, 200, cors);
  }

  await applyPagesVisitedUpdate(session, pages_visited);
  if (max_scroll_depth_pct != null) {
    session.summary.max_scroll_depth_percent = max_scroll_depth_pct;
  }

  // Partial checkpoint — journey saved, session stays open.
  if (!ended_at) {
    await session.save();
    return jsonWithCors({ ok: true, finalized: false }, 200, cors);
  }

  await backfillMissingTemplates(session);

  if (!session.entry_template && session.pages_visited.length) {
    session.entry_template = session.pages_visited[0].template;
  }

  const { fixation_count, pages_touched } = await finalizeSessionAndRollup(
    session,
    new Date(ended_at)
  );

  return jsonWithCors(
    { ok: true, fixation_count, pages: pages_touched },
    200,
    cors
  );
}
