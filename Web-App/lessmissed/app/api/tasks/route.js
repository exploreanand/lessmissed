import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Task from "@/lib/models/Task";

// GET /api/tasks?project_id=...
export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const filter = {};
  if (searchParams.get("project_id")) filter.project_id = searchParams.get("project_id");
  if (searchParams.get("status")) filter.status = searchParams.get("status");

  const tasks = await Task.find(filter).sort({ created_at: -1 }).lean();
  return NextResponse.json(tasks);
}

// POST /api/tasks
export async function POST(request) {
  await connectDB();
  const body = await request.json();
  const task = await Task.create(body);
  return NextResponse.json(task, { status: 201 });
}
