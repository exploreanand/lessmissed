import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// GET /api/projects/:id/pages/:pageSlug/screenshot
// Returns: { url, viewport_width, viewport_height, document_height } or 404
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, pageSlug } = await params;

  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const screenshotUrl = page.screenshot_url;
  if (!screenshotUrl) {
    return NextResponse.json({ error: "No screenshot captured yet" }, { status: 404 });
  }

  return NextResponse.json({
    url: screenshotUrl,
    viewport_width: page.screenshot_viewport_width ?? null,
    viewport_height: page.screenshot_viewport_height ?? null,
    document_height: page.screenshot_document_height ?? null,
    captured_at: page.screenshot_captured_at ?? null,
    header_url: page.screenshot_header_url ?? null,
    header_height: page.screenshot_header_height ?? null,
  });
}