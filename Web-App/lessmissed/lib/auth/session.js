import { cookies } from "next/headers";
import { connectDB } from "@/lib/mongoose";
import User from "@/lib/models/User";

export const SESSION_COOKIE = "lessmissed_session";

// Single source of truth for "is there a valid session, and who is it".
// Server Components/layouts: redirect("/login") on null.
// Route Handlers: return 401 on null.
export async function getSessionUser() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value || session.value === "demo") return null;

  await connectDB();
  let user;
  try {
    user = await User.findById(session.value).select("_id name email plan type").lean();
  } catch {
    return null;
  }
  if (!user) return null;

  return {
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
    plan: user.plan ?? "starter",
    type: user.type,
  };
}
