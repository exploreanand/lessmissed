import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";

// GET /api/extension/resolve?domain=suvria.com
// Reads the lessmissed_session cookie (= MongoDB userId) and finds the project
// belonging to that user whose domain matches the requested domain.
export async function GET(request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawDomain = searchParams.get("domain")?.toLowerCase().trim();

    if (!rawDomain) {
      return NextResponse.json({ error: "domain query param required" }, { status: 400 });
    }

    // Normalise: strip www. so "www.suvria.com" matches a project stored as "suvria.com"
    const domain = rawDomain.replace(/^www\./, "");

    await connectDB();

    // Try exact match first, then www. variant
    const project = await Project.findOne({
      client_id: user.userId,
      domain: { $in: [domain, `www.${domain}`] },
    })
      .select("_id name domain pages")
      .lean();

    if (!project) {
      return NextResponse.json({ error: "No project found for this domain" }, { status: 404 });
    }

    return NextResponse.json({
      consumer_id: user.userId,
      project_id: project._id.toString(),
      project_name: project.name,
      domain: project.domain,
      pages: project.pages.map((p) => ({ path: p.path, slug: p.slug })),
    });
  } catch (err) {
    console.error("[resolve] error:", err);
    return NextResponse.json({ error: err.message ?? "Internal error" }, { status: 500 });
  }
}
