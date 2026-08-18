import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";

// GET /api/projects — list all projects for the logged-in client
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const projects = await Project.find({ client_id: user.userId }).sort({ created_at: -1 }).lean();
  return NextResponse.json(projects);
}

// POST /api/projects — create a new project for the logged-in client
export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const body = await request.json();
  const project = await Project.create({ ...body, client_id: user.userId });
  return NextResponse.json(project, { status: 201 });
}
