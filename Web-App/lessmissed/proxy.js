import { NextResponse } from "next/server";

// Next 16 proxy (formerly "middleware"). Runs before any matched route handler.
//
// The public deployment ingests data only through the <script> tag
// (/api/tag/*, which is key- and origin-authenticated). The older
// /api/extension/* surface has no authentication at all, so it must not be
// reachable on the internet. Set ENABLE_EXTENSION_API=true in the environment
// to turn it back on — e.g. local development with the Chrome extension.
export const config = {
  matcher: ["/api/extension/:path*"],
};

export default function proxy() {
  if (process.env.ENABLE_EXTENSION_API === "true") {
    return NextResponse.next();
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
