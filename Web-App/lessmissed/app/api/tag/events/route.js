import { connectDB } from "@/lib/mongoose";
import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { normalizePath } from "@/lib/pathTemplate";
import { handleTagPreflight, authenticateTagRequest, jsonWithCors } from "@/lib/tag/cors";

// POST /api/tag/events
// Body: { session_id, events: [{ timestamp, type, page_url, data }] }
//
// Mirror of /api/extension/events. The key + origin check is enough to
// authorize the batch — the session's project_id is looked up server-side
// (and cross-checked against the tag's project) so a leaked key from one
// project cannot post events into another project's session by id.
export const OPTIONS = handleTagPreflight;

export async function POST(request) {
  const auth = await authenticateTagRequest(request);
  if (!auth.ok) return auth.response;
  const { project, cors } = auth;

  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ error: "Invalid JSON" }, 400, cors);
  }

  const { session_id, events } = body;
  if (!session_id || !Array.isArray(events) || events.length === 0) {
    return jsonWithCors(
      { error: "session_id and non-empty events array required" },
      400,
      cors
    );
  }

  const session = await Session.findOne({ session_id })
    .select("project_id consumer_id status")
    .lean();
  if (!session) return jsonWithCors({ error: "Session not found" }, 404, cors);
  // Prevent one project's leaked key from being pointed at another project's
  // session_id — the extension surface never had to worry about this because
  // sessions there are always cookie-scoped to the current consumer.
  if (session.project_id.toString() !== project._id.toString()) {
    return jsonWithCors({ error: "Session belongs to a different project" }, 403, cors);
  }
  if (session.status === "abandoned") {
    return jsonWithCors({ error: "Session is abandoned" }, 409, cors);
  }

  const docs = events.map((ev) => ({
    timestamp: new Date(ev.timestamp),
    session_id,
    type: ev.type,
    page_url: ev.page_url ?? "/",
    page_template: normalizePath(ev.page_url ?? "/"),
    data: ev.data ?? {},
    metadata: {
      project_id: session.project_id,
      consumer_id: session.consumer_id,
    },
  }));

  let inserted = 0;
  try {
    const result = await Event.insertMany(docs, { ordered: false });
    inserted = result.length;
  } catch (err) {
    // insertMany({ordered:false}) throws on partial failure; nInserted has the
    // count that landed. Zero means the batch was structurally wrong.
    inserted = err.result?.nInserted ?? 0;
    if (inserted === 0) {
      return jsonWithCors({ error: "All events failed to insert" }, 500, cors);
    }
  }

  const clicks = events.filter((e) => e.type === "click").length;
  const scrolls = events.filter((e) => e.type === "scroll" && e.data?.is_stop).length;
  const gazes = events.filter((e) => e.type === "gaze").length;

  const inc = {};
  if (clicks) inc["summary.total_clicks"] = clicks;
  if (scrolls) inc["summary.total_scroll_events"] = scrolls;
  if (gazes) inc["summary.total_fixations"] = gazes;

  if (Object.keys(inc).length) {
    await Session.updateOne({ session_id }, { $inc: inc });
  }

  return jsonWithCors({ ok: true, inserted }, 200, cors);
}
