import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import Session from "@/lib/models/Session";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import Task from "@/lib/models/Task";
import Coupon from "@/lib/models/Coupon";
import ConsumerReward from "@/lib/models/ConsumerReward";
import { deleteProjectFromS3 } from "@/lib/s3";

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
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("lessmissed_session");
    if (!session?.value || session.value === "demo") {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    await connectDB();
    const { id } = await params;
    const project = await Project.findById(id).lean();
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (project.client_id.toString() !== session.value) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
