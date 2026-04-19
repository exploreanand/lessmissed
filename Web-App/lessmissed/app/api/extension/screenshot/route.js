import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";

// POST /api/extension/screenshot
// Body: { project_id, page_url, page_slug, image_base64, viewport_width, viewport_height, document_height }
export async function POST(request) {
  const {
    project_id,
    page_url,
    page_slug,
    image_base64,
    viewport_width,
    viewport_height,
    document_height,
  } = await request.json();

  if (!image_base64 || !project_id || !page_slug) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Strip the data URL prefix (data:image/jpeg;base64,...)
  const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  // Save to public/screenshots/{project_id}/{page_slug}.jpg
  const projectDir = join(process.cwd(), "public", "screenshots", project_id);
  await mkdir(projectDir, { recursive: true });

  const filename = `${page_slug}.jpg`;
  await writeFile(join(projectDir, filename), buffer);

  const screenshotUrl = `/screenshots/${project_id}/${filename}`;

  // Persist metadata to the project page document
  try {
    await connectDB();
    await Project.updateOne(
      { _id: project_id, "pages.slug": page_slug },
      {
        $set: {
          "pages.$.screenshot_url": screenshotUrl,
          "pages.$.screenshot_viewport_width": viewport_width ?? null,
          "pages.$.screenshot_viewport_height": viewport_height ?? null,
          "pages.$.screenshot_document_height": document_height ?? null,
          "pages.$.screenshot_captured_at": new Date(),
        },
      }
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
