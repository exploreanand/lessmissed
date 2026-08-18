import { NextResponse } from "next/server";
import Fixation from "@/lib/models/Fixation";
import Event from "@/lib/models/Event";
import { computeFirstFixation } from "@/lib/insights/firstFixation";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// Kills the Next.js cache so your heatmap always shows fresh data!
export const dynamic = "force-dynamic";

// GET /api/projects/:id/pages/:pageSlug/heatmap
// Query: type (gaze|click|cursor|scroll|first_fixation), date_from, date_to
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, pageSlug } = await params;
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "gaze";

  // Resolve page path from slug
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const page = project.pages.find((p) => p.slug === pageSlug);
  if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

  const dateFilter = {};
  if (searchParams.get("date_from")) dateFilter.$gte = new Date(searchParams.get("date_from"));
  if (searchParams.get("date_to")) dateFilter.$lte = new Date(searchParams.get("date_to"));

  let points = [];

  if (type === "gaze") {
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
      value: Math.min(f.duration_ms / 100, 10),
    }));
  } else if (type === "click") {
    const events = await Event.find({
      "metadata.project_id": id,
      page_url: page.path,
      type: "click",
      ...(Object.keys(dateFilter).length ? { timestamp: dateFilter } : {}),
    })
      .select("data.viewport_x data.viewport_y data.scroll_x data.scroll_y")
      .lean();

    points = events.map((e) => ({
      x: (e.data?.viewport_x ?? 0) + (e.data?.scroll_x ?? 0),
      y: (e.data?.viewport_y ?? 0) + (e.data?.scroll_y ?? 0),
      value: 1,
    }));
  } else if (type === "cursor") {
    const events = await Event.find({
      "metadata.project_id": id,
      page_url: page.path,
      type: "cursor",
      ...(Object.keys(dateFilter).length ? { timestamp: dateFilter } : {}),
    })
      .select("data.viewport_x data.viewport_y data.scroll_x data.scroll_y")
      .limit(5000)
      .lean();

    points = events.map((e) => ({
      x: (e.data?.viewport_x ?? 0) + (e.data?.scroll_x ?? 0),
      y: (e.data?.viewport_y ?? 0) + (e.data?.scroll_y ?? 0),
      value: 1,
    }));
  } else if (type === "scroll") {
    // --- ATTENTION SCROLL HEATMAP (Time Spent) ---
    
    // We fetch ALL events (cursor, gaze, click, visibility) to act as a continuous timer
    const events = await Event.find({
      "metadata.project_id": id,
      page_url: page.path,
      ...(Object.keys(dateFilter).length ? { timestamp: dateFilter } : {}),
    })
      .sort({ timestamp: 1 })
      .select("timestamp session_id type data.depth_pct")
      .lean();

    const bands = Array.from({ length: 10 }, (_, i) => ({
      band: `${i * 10}-${(i + 1) * 10}%`,
      min: i * 10,
      max: (i + 1) * 10,
      session_count: 0,
    }));

    // Group all events by session
    const sessionsEvents = {};
    events.forEach((e) => {
      if (!sessionsEvents[e.session_id]) sessionsEvents[e.session_id] = [];
      sessionsEvents[e.session_id].push(e);
    });

    Object.values(sessionsEvents).forEach((sessionArray) => {
      let currentDepth = 0;
      let lastTimestamp = null;

      sessionArray.forEach((e) => {
        if (lastTimestamp) {
          // Calculate time passed since the last event (whether it was a scroll, mouse move, or click)
          const timeDiffSeconds = (new Date(e.timestamp) - new Date(lastTimestamp)) / 1000;
          
          // Cap idle time at 30 seconds
          const validTime = Math.min(Math.max(timeDiffSeconds, 0), 30);
          
          // Add that time to whatever depth the user is currently at
          const idx = Math.min(Math.floor(currentDepth / 10), 9);
          bands[idx].session_count += validTime;
        }

        // If they scrolled, update the depth for the next timer calculation
        if (e.type === "scroll" && e.data?.depth_pct !== undefined) {
          currentDepth = e.data.depth_pct;
        }

        lastTimestamp = e.timestamp;
      });
    });

    // Round to 1 decimal place (e.g., 0.3s)
    bands.forEach((band) => {
      band.session_count = Math.round(band.session_count * 10) / 10;
    });

    return NextResponse.json({ type, page_path: page.path, scroll_depth_bands: bands });
  } else if (type === "first_fixation") {
    // INS-G04: distinct payload — first-look markers + region, not a points cloud
    const firstFixation = await computeFirstFixation(project, page);
    return NextResponse.json({ type, page_path: page.path, first_fixation: firstFixation });
  }

  return NextResponse.json({ type, page_path: page.path, points, total: points.length });
}