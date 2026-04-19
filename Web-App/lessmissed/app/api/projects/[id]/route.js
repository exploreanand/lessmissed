import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";

// GET /api/projects/:id
export async function GET(request, { params }) {
  await connectDB();
  const project = await Project.findById(params.id).lean();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

// PUT /api/projects/:id
export async function PUT(request, { params }) {
  await connectDB();
  const body = await request.json();
  const project = await Project.findByIdAndUpdate(params.id, body, { new: true }).lean();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

// DELETE /api/projects/:id
export async function DELETE(request, { params }) {
  await connectDB();
  await Project.findByIdAndDelete(params.id);
  return NextResponse.json({ ok: true });
}
