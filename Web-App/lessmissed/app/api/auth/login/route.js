import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongoose";
import User from "@/lib/models/User";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request) {
  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  // Both roles use the same login endpoint. Clients land on the dashboard;
  // consumers land on the customer landing page (see LoginForm routing).
  const user = await User.findOne({ email: email.toLowerCase() }).lean();
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (user.password_hash) {
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
  }

  await User.updateOne({ _id: user._id }, { $set: { last_login: new Date() } });

  const response = NextResponse.json({
    ok: true,
    userId: user._id.toString(),
    name: user.name,
    type: user.type,
  });
  response.cookies.set(SESSION_COOKIE, user._id.toString(), {
    path: "/",
    httpOnly: true,
    maxAge: 86400 * 7,
    sameSite: "lax",
  });
  return response;
}
