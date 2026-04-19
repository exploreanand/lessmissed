import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";

// POST /api/extension/events
// Body: { session_id, events: [{ timestamp, type, page_url, data }] }
// Called by the extension background worker every ~1s with a batch of up to 50 events.
export async function POST(request) {
  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { session_id, events } = body;

  if (!session_id || !Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "session_id and non-empty events array required" }, { status: 400 });
  }

  // Resolve session to get project_id and consumer_id for event metadata
  const session = await Session.findOne({ session_id }).select("project_id consumer_id status").lean();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "abandoned") {
    return NextResponse.json({ error: "Session is abandoned" }, { status: 409 });
  }

  // Map incoming events to Event model shape
  const docs = events.map((ev) => ({
    timestamp: new Date(ev.timestamp),
    session_id,
    type: ev.type,
    page_url: ev.page_url ?? "/",
    data: ev.data ?? {},
    metadata: {
      project_id: session.project_id,
      consumer_id: session.consumer_id,
    },
  }));

  // Bulk insert — ordered: false so a single bad doc doesn't block the rest
  let inserted = 0;
  try {
    const result = await Event.insertMany(docs, { ordered: false });
    inserted = result.length;
  } catch (err) {
    // insertMany with ordered:false throws on partial failures; check result
    inserted = err.result?.nInserted ?? 0;
    if (inserted === 0) {
      return NextResponse.json({ error: "All events failed to insert" }, { status: 500 });
    }
  }

  // Atomically increment session summary counters for the inserted events
  const clicks  = events.filter((e) => e.type === "click").length;
  const scrolls = events.filter((e) => e.type === "scroll" && e.data?.is_stop).length;
  const gazes   = events.filter((e) => e.type === "gaze").length;

  const inc = {};
  if (clicks)  inc["summary.total_clicks"]        = clicks;
  if (scrolls) inc["summary.total_scroll_events"] = scrolls;
  if (gazes)   inc["summary.total_fixations"]     = gazes; // rough count, fixations derived later

  if (Object.keys(inc).length) {
    await Session.updateOne({ session_id }, { $inc: inc });
  }

  return NextResponse.json({ ok: true, inserted });
}
