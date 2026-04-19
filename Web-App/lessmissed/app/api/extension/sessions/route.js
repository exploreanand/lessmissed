import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import { nanoid } from "nanoid";

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

  const session = await Session.create({
    session_id,
    consumer_id,
    task_id: task_id ?? null,
    project_id,
    status: "active",
    pages_visited: page_url ? [{ path: page_url, entered_at: new Date(started_at ?? Date.now()) }] : [],
    pages_required: [],
    started_at: new Date(started_at ?? Date.now()),
    engagement_score: 0,
    data_accepted: false,
  });

  // Increment project-level session counter
  await Project.updateOne({ _id: project_id }, { $inc: { total_sessions: 1 } });

  return NextResponse.json({ ok: true, session_id: session.session_id }, { status: 201 });
}
