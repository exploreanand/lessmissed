import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Coupon from "@/lib/models/Coupon";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// GET /api/coupons
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const coupons = await Coupon.find({ client_id: user.userId }).sort({ created_at: -1 }).lean();
  return NextResponse.json(coupons);
}

// POST /api/coupons
export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const body = await request.json();

  const project = await getOwnedProject(body.project_id, user);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const coupon = await Coupon.create({ ...body, client_id: user.userId });
  return NextResponse.json(coupon, { status: 201 });
}
