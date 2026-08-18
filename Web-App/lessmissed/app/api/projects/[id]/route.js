import { NextResponse } from "next/server";
import Project from "@/lib/models/Project";
import Session from "@/lib/models/Session";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import Task from "@/lib/models/Task";
import Coupon from "@/lib/models/Coupon";
import ConsumerReward from "@/lib/models/ConsumerReward";
import { deleteProjectFromS3 } from "@/lib/s3";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// GET /api/projects/:id
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

// PUT /api/projects/:id
export async function PUT(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const existing = await getOwnedProject(id, user);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const project = await Project.findByIdAndUpdate(id, body, { new: true }).lean();
  return NextResponse.json(project);
}

// DELETE /api/projects/:id
export async function DELETE(request, { params }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { id } = await params;
    const project = await getOwnedProject(id, user);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const couponIds = await Coupon.find({ project_id: id }).distinct("_id");

    await Promise.all([
      Session.deleteMany({ project_id: id }),
      Fixation.deleteMany({ project_id: id }),
      Event.deleteMany({ "metadata.project_id": id }),
      Task.deleteMany({ project_id: id }),
      Coupon.deleteMany({ project_id: id }),
      ConsumerReward.deleteMany({ coupon_id: { $in: couponIds } }),
      deleteProjectFromS3(id),
    ]);

    await Project.findByIdAndDelete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/projects/:id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
