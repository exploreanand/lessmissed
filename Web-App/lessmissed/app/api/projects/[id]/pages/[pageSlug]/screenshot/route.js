import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { existsSync } from "fs";
import { join } from "path";

// GET /api/projects/:id/pages/:pageSlug/screenshot
// Returns: { url, viewport_width, viewport_height, document_height } or 404
export async function GET(request, { params }) {
  await connectDB();
  const { id, pageSlug } = await params;

  const project = await Project.findById(id).lean();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  // Check if a screenshot file actually exists on disk
  const screenshotUrl = page.screenshot_url;
  if (!screenshotUrl) {
    return NextResponse.json({ error: "No screenshot captured yet" }, { status: 404 });
  }

  const filePath = join(process.cwd(), "public", screenshotUrl);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "Screenshot file not found" }, { status: 404 });
  }

  return NextResponse.json({
    url: screenshotUrl,
    viewport_width: page.screenshot_viewport_width ?? null,
    viewport_height: page.screenshot_viewport_height ?? null,
    document_height: page.screenshot_document_height ?? null,
    captured_at: page.screenshot_captured_at ?? null,
  });
}
