import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";

// POST /api/extension/screenshot
// Body: { project_id, page_url, page_slug, image_base64, viewport_width, viewport_height,
//         document_height, header_image_base64?, header_height? }
export async function POST(request) {
  const {
    project_id,
    page_url,
    page_slug,
    image_base64,
    viewport_width,
    viewport_height,
    document_height,
    header_image_base64,
    header_height,
  } = await request.json();

  if (!image_base64 || !project_id || !page_slug) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Resolve the canonical page from the DB so we use the correct slug even when
  // the browser redirected to a different path than the configured page.path.
  await connectDB();
  const project = await Project.findById(project_id).lean();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Fallback chain: exact slug → exact path → path prefix → root page → first page
  const pages = project.pages ?? [];
  const resolvedPage =
    pages.find((p) => p.slug === page_slug) ||
    (page_url && pages.find((p) => p.path === page_url)) ||
    (page_url && pages.find((p) => p.path !== "/" && page_url.startsWith(p.path))) ||
    pages.find((p) => p.path === "/") ||
    pages[0];

  if (!resolvedPage) {
    return NextResponse.json({ error: "No matching page found" }, { status: 404 });
  }

  const canonicalSlug = resolvedPage.slug;

  // Save full-page screenshot
  const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const projectDir = join(process.cwd(), "public", "screenshots", project_id);
  await mkdir(projectDir, { recursive: true });

  const filename = `${canonicalSlug}.jpg`;
  await writeFile(join(projectDir, filename), buffer);
  const screenshotUrl = `/screenshots/${project_id}/${filename}`;

  // Save nav header image (optional)
  let headerScreenshotUrl = null;
  if (header_image_base64 && header_height > 0) {
    const headerBase64Data = header_image_base64.replace(/^data:image\/\w+;base64,/, "");
    const headerBuffer = Buffer.from(headerBase64Data, "base64");
    const headerFilename = `${canonicalSlug}-header.jpg`;
    await writeFile(join(projectDir, headerFilename), headerBuffer);
    headerScreenshotUrl = `/screenshots/${project_id}/${headerFilename}`;
  }

  // Persist metadata to the project page document
  try {
    await Project.updateOne(
      { _id: project_id, "pages.slug": canonicalSlug },
      {
        $set: {
          "pages.$.screenshot_url": screenshotUrl,
          "pages.$.screenshot_viewport_width": viewport_width ?? null,
          "pages.$.screenshot_viewport_height": viewport_height ?? null,
          "pages.$.screenshot_document_height": document_height ?? null,
          "pages.$.screenshot_captured_at": new Date(),
          "pages.$.screenshot_header_url": headerScreenshotUrl,
          "pages.$.screenshot_header_height": header_height ?? null,
        },
      },
      { strict: false }
    );
  } catch (err) {
    console.error("[LessMissed] Failed to update page screenshot metadata:", err.message);
  }

  return NextResponse.json({
    ok: true,
    url: screenshotUrl,
    viewport_width,
    viewport_height,
    document_height,
  });
}