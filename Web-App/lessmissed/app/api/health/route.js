import { NextResponse } from "next/server";

// Liveness probe for the ALB target group and the Route 53 health check.
//
// Plain GET /api/health never touches MongoDB, so a database hiccup can't make
// ECS tear down otherwise-healthy web tasks. GET /api/health?db=1 additionally
// pings Mongo and is meant for the smoke-test checklist, not the load balancer.
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get("db") !== "1") {
    return NextResponse.json({ ok: true });
  }

  try {
    const { connectDB } = await import("@/lib/mongoose");
    const conn = await connectDB();
    await conn.connection.db.admin().ping();
    return NextResponse.json({ ok: true, db: "up" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, db: "down", error: err.message },
      { status: 503 }
    );
  }
}
