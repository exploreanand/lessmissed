import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";

// GET /api/extension/resolve?domain=suvria.com
// Reads the lessmissed_session cookie (= MongoDB userId) and finds the project
// whose domain matches the requested domain.
//
// Any authenticated user can contribute session data to any project — the
// consumer_id in the returned payload is the current user, so the session is
// still attributed to the person actually browsing. The project the data
// lands in is the brand's canonical project for that domain, not necessarily
// one the browsing user created. This is what makes crowd-contributed data
// possible: a visitor to suvria.com doesn't need to own the suvria.com
// project to feed it session data.
//
// When multiple projects exist for the same domain (multi-tenant setups, a
// user who cloned another user's config), we prefer the current user's own
// project so a self-serve brand keeps landing in their own workspace, then
// fall back to the oldest matching project — typically the brand's canonical
// one, since a canonical setup precedes clones and forks.
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
    const domainMatch = { $in: [domain, `www.${domain}`] };

    await connectDB();

    // Prefer the browsing user's own project (self-serve setups keep their
    // data in their own workspace), then fall back to any project for that
    // domain. Two-step because a single $or with a $sort could rank an older
    // stranger's project above the current user's newer one — which would
    // silently move a self-serve brand's own data out of their workspace.
    let project = await Project.findOne({
      client_id: user.userId,
      domain: domainMatch,
    })
      .select("_id name domain pages")
      .lean();

    if (!project) {
      project = await Project.findOne({
        domain: domainMatch,
        status: { $ne: "archived" },
      })
        .sort({ created_at: 1 })
        .select("_id name domain pages")
        .lean();
    }

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
