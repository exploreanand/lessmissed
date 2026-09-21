import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import CaptureJob from "@/lib/models/CaptureJob";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";
import { enqueueCapture } from "@/lib/capture/enqueue";
import { isValidBreakpoint } from "@/lib/capture/breakpoints";

// An admin who just edited their page will click this immediately. One render
// per page per minute is plenty, and it stops an impatient click-through from
// queueing a dozen identical jobs.
const RECAPTURE_COOLDOWN_MS = 60_000;

// POST /api/projects/:id/pages/:pageSlug/recapture
// Body: { breakpoint? }
//
// The "Recapture / Update baseline" button. Unlike a drift-triggered capture,
// this always produces a new version even if the page turns out to be visually
// identical — an explicit human action deserves a record that it happened.
export async function POST(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, pageSlug } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = (project.pages ?? []).find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  if (!page.capture_url) {
    return NextResponse.json(
      { error: "This page has no URL configured yet. Add one before capturing." },
      { status: 409 }
    );
  }

  let body = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    // An empty body is fine — it means "the default breakpoint".
  }

  const breakpoint = body.breakpoint ?? page.capture_breakpoints?.[0] ?? "desktop";
  if (!isValidBreakpoint(breakpoint)) {
    return NextResponse.json({ error: `Unknown breakpoint: ${breakpoint}` }, { status: 400 });
  }

  await connectDB();

  const recent = await CaptureJob.findOne({
    page_id: page._id,
    breakpoint,
    reason: "manual",
    created_at: { $gt: new Date(Date.now() - RECAPTURE_COOLDOWN_MS) },
  })
    .sort({ created_at: -1 })
    .lean();

  if (recent && ["queued", "leased"].includes(recent.status)) {
    return NextResponse.json(
      {
        queued: false,
        already_running: true,
        message: "A capture of this page is already under way.",
      },
      { status: 202 }
    );
  }

  const { created } = await enqueueCapture({
    projectId: project._id,
    pageId: page._id,
    breakpoint,
    reason: "manual",
  });

  await Project.updateOne(
    { _id: project._id, "pages._id": page._id },
    { $set: { "pages.$.screenshot_status": "queued" } }
  );

  return NextResponse.json({ queued: true, created, breakpoint }, { status: 202 });
}
