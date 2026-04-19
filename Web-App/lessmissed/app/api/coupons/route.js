import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Coupon from "@/lib/models/Coupon";

// GET /api/coupons
export async function GET() {
  await connectDB();
  const coupons = await Coupon.find({}).sort({ created_at: -1 }).lean();
  return NextResponse.json(coupons);
}

// POST /api/coupons
export async function POST(request) {
  await connectDB();
  const body = await request.json();
  const coupon = await Coupon.create(body);
  return NextResponse.json(coupon, { status: 201 });
}
