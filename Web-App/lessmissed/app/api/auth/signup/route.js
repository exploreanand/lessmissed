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

  const { name, email, password } = body;
  if (!name || !email || !password) {
    return NextResponse.json({ error: "name, email, and password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const user = await User.create({
    type: "client",
    email: email.toLowerCase(),
    password_hash,
    name,
    last_login: new Date(),
  });

  const response = NextResponse.json(
    { ok: true, userId: user._id.toString(), name: user.name },
    { status: 201 }
  );
  response.cookies.set(SESSION_COOKIE, user._id.toString(), {
    path: "/",
    httpOnly: true,
    maxAge: 86400 * 7,
    sameSite: "lax",
  });
  return response;
}
