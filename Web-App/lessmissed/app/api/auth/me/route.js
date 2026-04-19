import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { connectDB } from "@/lib/mongoose";
import User from "@/lib/models/User";

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get("lessmissed_session");

  if (!session?.value || session.value === "demo") {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  await connectDB();

  let user;
  try {
    user = await User.findById(session.value).select("_id name email plan").lean();
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 401 });

  return NextResponse.json({
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
    plan: user.plan ?? "starter",
  });
}
