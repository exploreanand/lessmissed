import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";

// GET /api/projects — list all projects for a client
export async function GET() {
  await connectDB();
  const projects = await Project.find({}).sort({ created_at: -1 }).lean();
  return NextResponse.json(projects);
}

// POST /api/projects — create a new project
export async function POST(request) {
  await connectDB();
  const body = await request.json();
  const project = await Project.create(body);
  return NextResponse.json(project, { status: 201 });
}
