import { connectDB } from "@/lib/mongoose";
import Event from "@/lib/models/Event";
import Session from "@/lib/models/Session";
import { normalizePath } from "@/lib/pathTemplate";
import { handleTagPreflight, authenticateTagRequest, jsonWithCors } from "@/lib/tag/cors";

// POST /api/tag/events
// Body: { session_id, events: [{ timestamp, type, page_url, data }] }
// Query: ?leaving=1 marks the visitor as having left (the tag's pagehide
//        beacon). Accepted with an empty events array, since there may be
//        nothing queued at that moment; see left_hint_at on the Session model.
//
// The key + origin check is enough to
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

  const leaving = new URL(request.url).searchParams.get("leaving") === "1";

  const { session_id, events } = body;
  if (!session_id || !Array.isArray(events)) {
    return jsonWithCors(
      { error: "session_id and an events array are required" },
      400,
      cors
    );
  }
  // An empty batch is only meaningful as a leave signal. Keep rejecting it
  // otherwise, so a genuinely malformed batch still gets a 400 rather than
  // being silently accepted as a no-op.
  if (events.length === 0 && !leaving) {
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
  // A completed session has already had its fixations derived, so anything
  // arriving now would be stored and never looked at again. Say so instead:
  // the tag treats 409 as "start a new session" and keeps recording. This used
  // to accept the events and silently drop them on the floor, which mattered
  // little when finalize was 30 minutes away and matters a lot now that it is
  // about a minute.
  if (session.status === "completed") {
    return jsonWithCors({ error: "Session already finalized" }, 409, cors);
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
    if (docs.length) {
      const result = await Event.insertMany(docs, { ordered: false });
      inserted = result.length;
    }
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
  // Raw samples, not fixations. summary.total_fixations is the derived count
  // and is written at finalize; incrementing it here made the session view
  // report roughly ten "fixations" per second of looking.
  if (gazes) inc["summary.total_gaze_samples"] = gazes;

  // Always refresh activity so the idle-session sweeper can finalize this
  // session once the visitor stops — the tag has no reliable client-side end.
  const update = { $set: { last_activity_at: new Date() } };
  if (Object.keys(inc).length) update.$inc = inc;

  if (leaving) {
    // pagehide that was not a same-site navigation. A hint, not an end: the
    // sweeper waits out a grace period, and the next page's visit or batch
    // clears it if the visitor is in fact still here.
    update.$set.left_hint_at = new Date();
  } else {
    // More events means they are still here.
    update.$unset = { left_hint_at: "" };
  }

  await Session.updateOne({ session_id }, update);

  return jsonWithCors({ ok: true, inserted }, 200, cors);
}
