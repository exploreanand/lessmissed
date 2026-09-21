import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";
import { addTargetPage, summarisePage, TargetPageError } from "@/lib/capture/targetPages";
import { loadMetricsForPages } from "@/lib/insights/pageMetrics";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/pages
// Target pages with their metrics, plus discovered suggestions awaiting a decision.
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await connectDB();

  const all = project.pages ?? [];
  const targets = all.filter((p) => p.target);

  // Computed from source data on every request. These used to be read from
  // page fields that nothing ever wrote, which is why every page showed 0 s
  // average fixation and a red 0 health badge.
  const metrics = await loadMetricsForPages(project, targets);

  return NextResponse.json({
    domain: project.domain,
    targets: targets.map((p) => ({
      ...summarisePage(p),
      metrics: metrics.get(String(p._id)) ?? null,
    })),
    // Registered by the extension on first visit. These still collect gaze, but
    // they are never captured until someone accepts them — the system only
    // photographs pages a human asked for.
    suggestions: all
      .filter((p) => !p.target && p.approval_status === "pending")
      .map(summarisePage),
  });
}

// POST /api/projects/:id/pages
// Body: { url, breakpoints?, mask_selectors?, dismiss_selectors? }
//
// Validates the URL, registers it as a target page, and queues its baseline
// capture — one call, because from the admin's side "add a page" and "get a
// picture of it" are the same intention.
export async function POST(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  await connectDB();

  try {
    const { page, queued, created } = await addTargetPage({
      project,
      url: body?.url,
      breakpoints: body?.breakpoints,
      maskSelectors: body?.mask_selectors,
      dismissSelectors: body?.dismiss_selectors,
    });

    return NextResponse.json(
      { page: summarisePage(page), queued, created },
      { status: created ? 201 : 200 }
    );
  } catch (err) {
    if (err instanceof TargetPageError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
