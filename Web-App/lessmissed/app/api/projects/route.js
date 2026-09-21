import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";
import { addTargetPage, summarisePage, TargetPageError } from "@/lib/capture/targetPages";

// GET /api/projects — list all projects for the logged-in client
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();
  const projects = await Project.find({ client_id: user.userId }).sort({ created_at: -1 }).lean();
  return NextResponse.json(projects);
}

// POST /api/projects — create a project and queue a baseline for each target page
//
// Body: { name, domain | url, target_urls?: string[] }
//
// The target pages are registered through addTargetPage, the same path the
// dashboard's "Add page" button uses. They used to be hand-built in the setup
// wizard and posted inside this body, which meant a page created during first
// setup carried no `target` flag, no `capture_url` and no CaptureJob — three
// separate reasons it was never captured. It only started working once the
// admin re-added it from the dashboard, because that promoted the existing row.
export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const domain = normaliseDomain(body?.domain ?? body?.url);

  if (!name) return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  if (!domain) return NextResponse.json({ error: "A valid site URL is required" }, { status: 400 });

  // Only these two fields are settable. The previous `Project.create({ ...body,
  // client_id })` let any caller seed `pages`, `health_score`, `total_sessions`
  // — or `client_id`, handing their own project to another account.
  const project = await Project.create({ name, domain, client_id: user.userId, pages: [] });

  const targetUrls = Array.isArray(body?.target_urls)
    ? body.target_urls.filter((u) => typeof u === "string" && u.trim()).slice(0, 50)
    : [];

  const pages = [];
  for (const url of targetUrls) {
    try {
      // Re-read between iterations so slug de-duplication and the
      // already-exists check see the pages added a moment ago.
      const current = await Project.findById(project._id).lean();
      const { page } = await addTargetPage({ project: current, url });
      pages.push({ url, ok: true, page: summarisePage(page) });
    } catch (err) {
      if (err instanceof TargetPageError) {
        // One bad URL must not cost the admin the whole project — they filled in
        // four screens to get here. Report it and keep the rest.
        pages.push({ url, ok: false, error: err.message });
      } else {
        throw err;
      }
    }
  }

  const created = await Project.findById(project._id).lean();
  return NextResponse.json({ ...created, target_pages: pages }, { status: 201 });
}

/**
 * "https://shop.acme.com/pricing" → "shop.acme.com".
 *
 * Project.domain is a bare hostname; scheme and path are dropped. Accepts what
 * an admin actually types, which is usually a full URL pasted from the browser.
 */
function normaliseDomain(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname || null;
  } catch {
    return null;
  }
}
