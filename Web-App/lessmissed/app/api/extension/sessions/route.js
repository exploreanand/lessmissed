import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import { nanoid } from "nanoid";
import { normalizePath } from "@/lib/pathTemplate";

// POST /api/extension/sessions
// Body: { project_id, consumer_id, task_id, page_url, started_at }
// Creates a new session and returns the session_id for the extension to use.
export async function POST(request) {
  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { project_id, consumer_id, task_id, page_url, started_at } = body;

  if (!project_id || !consumer_id) {
    return NextResponse.json({ error: "project_id and consumer_id are required" }, { status: 400 });
  }

  const session_id = `sess_${nanoid(10)}`;
  const startedAt = new Date(started_at ?? Date.now());
  const entryTemplate = page_url ? normalizePath(page_url) : null;

  const session = await Session.create({
    session_id,
    consumer_id,
    task_id: task_id ?? null,
    project_id,
    status: "active",
    // The entry page only. Every page after it is appended by
    // POST /api/extension/visits as the consumer moves through the site.
    pages_visited: page_url
      ? [{ path: page_url, template: entryTemplate, entered_at: startedAt }]
      : [],
    entry_template: entryTemplate,
    exit_template: entryTemplate,
    pages_required: [],
    started_at: startedAt,
    engagement_score: 0,
    data_accepted: false,
  });

  // Increment project-level session counter
  await Project.updateOne({ _id: project_id }, { $inc: { total_sessions: 1 } });

  return NextResponse.json({ ok: true, session_id: session.session_id }, { status: 201 });
}
