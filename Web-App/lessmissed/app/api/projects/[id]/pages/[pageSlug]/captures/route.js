import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import PageCapture from "@/lib/models/PageCapture";
import CaptureJob from "@/lib/models/CaptureJob";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/pages/:pageSlug/captures?breakpoint=desktop
//
// Version history plus live job state. The dashboard polls this after adding a
// page or clicking Recapture, which is why in-flight jobs are reported here
// rather than only finished captures — "queued", "rendering" and "failed" are
// all things the admin needs to see, and the old system could show none of them.
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, pageSlug } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = (project.pages ?? []).find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const url = new URL(request.url);
  const breakpoint = url.searchParams.get("breakpoint") ?? "desktop";

  await connectDB();

  const [versions, activeJob] = await Promise.all([
    PageCapture.find({ page_id: page._id, breakpoint })
      .sort({ captured_at: -1 })
      .limit(20)
      .lean(),
    CaptureJob.findOne({
      page_id: page._id,
      breakpoint,
      status: { $in: ["queued", "leased"] },
    })
      .sort({ created_at: -1 })
      .lean(),
  ]);

  const currentId = page.current_capture?.[breakpoint];

  return NextResponse.json({
    page: {
      slug: page.slug,
      path: page.path,
      capture_url: page.capture_url ?? null,
      screenshot_status: page.screenshot_status ?? "none",
      availability_status: page.availability_status ?? "ok",
      availability_error: page.availability_error ?? null,
      last_checked_at: page.last_checked_at ?? null,
    },
    // What the viewer should be drawing on right now.
    current: versions.find((v) => String(v._id) === String(currentId)) ?? null,
    in_progress: activeJob
      ? {
          status: activeJob.status === "leased" ? "rendering" : "queued",
          reason: activeJob.reason,
          attempts: activeJob.attempts,
          queued_at: activeJob.created_at,
        }
      : null,
    versions: versions.map((v) => ({
      id: String(v._id),
      status: v.status,
      reason: v.reason,
      captured_at: v.captured_at,
      viewport_width: v.viewport_width,
      document_height: v.document_height,
      bytes: v.bytes,
      duration_ms: v.duration_ms,
      error: v.error ?? null,
      // Null on a baseline; 0 is a real answer meaning "rendered, nothing moved".
      changed_pct: v.diff_vs_previous?.changed_pct ?? null,
      height_changed: v.diff_vs_previous?.height_changed ?? false,
      changed_boxes: v.diff_vs_previous?.changed_boxes ?? [],
      is_current: String(v._id) === String(currentId),
    })),
  });
}
