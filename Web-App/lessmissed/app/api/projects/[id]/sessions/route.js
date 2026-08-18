import { NextResponse } from "next/server";
import Session from "@/lib/models/Session";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// GET /api/projects/:id/sessions
// Query: page, status, min_score, date_from, date_to, limit, offset
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);

  const filter = { project_id: id };
  if (searchParams.get("status")) filter.status = searchParams.get("status");
  if (searchParams.get("min_score"))
    filter.engagement_score = { $gte: Number(searchParams.get("min_score")) };
  if (searchParams.get("date_from") || searchParams.get("date_to")) {
    filter.started_at = {};
    if (searchParams.get("date_from")) filter.started_at.$gte = new Date(searchParams.get("date_from"));
    if (searchParams.get("date_to")) filter.started_at.$lte = new Date(searchParams.get("date_to"));
  }
  if (searchParams.get("page")) {
    filter["pages_visited.path"] = searchParams.get("page");
  }

  const limit = Number(searchParams.get("limit") ?? 50);
  const offset = Number(searchParams.get("offset") ?? 0);

  const [sessions, total] = await Promise.all([
    Session.find(filter).sort({ started_at: -1 }).skip(offset).limit(limit).lean(),
    Session.countDocuments(filter),
  ]);

  return NextResponse.json({ sessions, total, limit, offset });
}
