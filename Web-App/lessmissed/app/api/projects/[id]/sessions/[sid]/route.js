import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";

// GET /api/projects/:id/sessions/:sid
export async function GET(request, { params }) {
  await connectDB();
  const { id, sid } = await params;
  const session = await Session.findOne({
    project_id: id,
    session_id: sid,
  }).lean();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(session);
}
