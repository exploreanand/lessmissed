import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import {
  applyPagesVisitedUpdate,
  backfillMissingTemplates,
  finalizeSessionAndRollup,
} from "@/lib/sessions/finalizeSession";

// Fixation derivation on large sessions can take tens of seconds.
export const maxDuration = 60;

// PATCH /api/extension/sessions/:id
// Body: { ended_at?, pages_visited?, max_scroll_depth_pct? }
//
// With `ended_at` this finalises the session: closes the open page visit,
// fills per-visit counters, derives fixations, computes engagement, and
// rolls the visit up onto each page. Without it, this is a partial update
// — the background worker uses that to checkpoint a long session's journey
// without ending it.
//
// The finalize logic lives in lib/sessions/finalizeSession.js and is shared
// with /api/tag/sessions/[id]. Do not inline it here — the two surfaces
// must produce identical downstream state or engagement/rollup counts drift
// between them.
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

  const session = await Session.findOne({ session_id });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "completed") {
    return NextResponse.json({ ok: true, already_finalized: true });
  }

  await applyPagesVisitedUpdate(session, pages_visited);
  if (max_scroll_depth_pct != null) {
    session.summary.max_scroll_depth_percent = max_scroll_depth_pct;
  }

  // Partial checkpoint — journey saved, session stays open.
  if (!ended_at) {
    await session.save();
    return NextResponse.json({ ok: true, finalized: false });
  }

  await backfillMissingTemplates(session);

  if (!session.entry_template && session.pages_visited.length) {
    session.entry_template = session.pages_visited[0].template;
  }

  const { fixation_count, pages_touched } = await finalizeSessionAndRollup(
    session,
    new Date(ended_at)
  );

  return NextResponse.json({ ok: true, fixation_count, pages: pages_touched });
}
