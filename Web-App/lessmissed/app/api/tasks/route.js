import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Task from "@/lib/models/Task";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// GET /api/tasks?project_id=...
export async function GET(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const { searchParams } = new URL(request.url);
  const filter = { client_id: user.userId };
  if (searchParams.get("project_id")) filter.project_id = searchParams.get("project_id");
  if (searchParams.get("status")) filter.status = searchParams.get("status");

  const tasks = await Task.find(filter).sort({ created_at: -1 }).lean();
  return NextResponse.json(tasks);
}

// POST /api/tasks
export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const body = await request.json();

  const project = await getOwnedProject(body.project_id, user);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const task = await Task.create({ ...body, client_id: user.userId });
  return NextResponse.json(task, { status: 201 });
}
