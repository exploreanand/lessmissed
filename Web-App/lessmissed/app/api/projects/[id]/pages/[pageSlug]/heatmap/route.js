import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";

// GET /api/projects/:id/pages/:pageSlug/heatmap
// Query: type (gaze|click|cursor|scroll), date_from, date_to
export async function GET(request, { params }) {
  await connectDB();
  const { id, pageSlug } = await params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "gaze";

  // Resolve page path from slug
  const project = await Project.findById(id).lean();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const dateFilter = {};
  if (searchParams.get("date_from")) dateFilter.$gte = new Date(searchParams.get("date_from"));
  if (searchParams.get("date_to")) dateFilter.$lte = new Date(searchParams.get("date_to"));

  let points = [];

  if (type === "gaze") {
    // Return fixation centers as weighted heatmap points (x, y, value=duration_ms)
    const fixations = await Fixation.find({
      project_id: id,
      page_url: page.path,
      ...(Object.keys(dateFilter).length ? { start_timestamp: dateFilter } : {}),
    })
      .select("center_x center_y duration_ms")
      .lean();

    points = fixations.map((f) => ({
      x: f.center_x,
      y: f.center_y,
      value: Math.min(f.duration_ms / 100, 10), // normalise duration to 0-10 weight
    }));
  } else if (type === "click") {
    const events = await Event.find({
      "metadata.project_id": id,
      page_url: page.path,
      type: "click",
      ...(Object.keys(dateFilter).length ? { timestamp: dateFilter } : {}),
    })
      .select("data.viewport_x data.viewport_y")
      .lean();

    points = events.map((e) => ({
      x: e.data?.viewport_x ?? 0,
      y: e.data?.viewport_y ?? 0,
      value: 1,
    }));
  } else if (type === "cursor") {
    const events = await Event.find({
      "metadata.project_id": id,
      page_url: page.path,
      type: "cursor",
      ...(Object.keys(dateFilter).length ? { timestamp: dateFilter } : {}),
    })
      .select("data.viewport_x data.viewport_y")
      .limit(5000)
      .lean();

    points = events.map((e) => ({
      x: e.data?.viewport_x ?? 0,
      y: e.data?.viewport_y ?? 0,
      value: 1,
    }));
  } else if (type === "scroll") {
    // Return scroll depth distribution as a series of {depth_pct, session_count}
    const sessions = await import("@/lib/models/Session").then((m) => m.default);
    const scrollData = await sessions
      .find({ project_id: id, status: "completed" })
      .select("summary.max_scroll_depth_percent")
      .lean();

    // Bucket into 10% bands
    const bands = Array.from({ length: 10 }, (_, i) => ({
      band: `${i * 10}-${(i + 1) * 10}%`,
      min: i * 10,
      max: (i + 1) * 10,
      session_count: 0,
    }));
    scrollData.forEach((s) => {
      const depth = s.summary?.max_scroll_depth_percent ?? 0;
      const idx = Math.min(Math.floor(depth / 10), 9);
      bands[idx].session_count++;
    });
    return NextResponse.json({ type, page_path: page.path, scroll_depth_bands: bands });
  }

  return NextResponse.json({ type, page_path: page.path, points, total: points.length });
}
