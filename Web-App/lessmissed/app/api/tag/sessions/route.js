import { nanoid } from "nanoid";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import { normalizePath } from "@/lib/pathTemplate";
import { handleTagPreflight, authenticateTagRequest, jsonWithCors } from "@/lib/tag/cors";
import { getOrCreateAnonymousConsumer, isValidVisitorId } from "@/lib/auth/anonymousConsumer";

// POST /api/tag/sessions
// Body: { visitor_id, page_url, task_id?, started_at?, viewport_width?, viewport_height?, dpr? }
//
// Mirror of /api/extension/sessions but auth'd by tag key (not cookie) and
// bound to a visitor_id (not a logged-in consumer). The visitor_id is minted
// into an anonymous User row so every downstream ref (Session, Event,
// Fixation) stays ObjectId-typed and every insight already written keeps
// working with no changes.
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

  const {
    visitor_id,
    task_id,
    page_url,
    started_at,
    viewport_width,
    viewport_height,
    dpr,
    breakpoint,
  } = body;

  if (!isValidVisitorId(visitor_id)) {
    return jsonWithCors(
      { error: "visitor_id is required (UUID from first-party cookie)" },
      400,
      cors
    );
  }

  const consumer_id = await getOrCreateAnonymousConsumer(visitor_id);
  if (!consumer_id) {
    return jsonWithCors({ error: "Failed to resolve visitor" }, 500, cors);
  }

  const session_id = `sess_${nanoid(10)}`;
  const startedAt = new Date(started_at ?? Date.now());
  const entryTemplate = page_url ? normalizePath(page_url) : null;

  const session = await Session.create({
    session_id,
    consumer_id,
    task_id: task_id ?? null,
    project_id: project._id,
    status: "active",
    // Only the entry page — every later page is appended by POST /visits.
    pages_visited: page_url
      ? [{ path: page_url, template: entryTemplate, entered_at: startedAt }]
      : [],
    entry_template: entryTemplate,
    exit_template: entryTemplate,
    pages_required: [],
    started_at: startedAt,
    engagement_score: 0,
    data_accepted: false,
    viewport_width: viewport_width ?? null,
    viewport_height: viewport_height ?? null,
    dpr: dpr ?? null,
    breakpoint: breakpoint === "mobile" ? "mobile" : "desktop",
  });

  await Project.updateOne({ _id: project._id }, { $inc: { total_sessions: 1 } });

  return jsonWithCors(
    { ok: true, session_id: session.session_id, consumer_id: consumer_id.toString() },
    201,
    cors
  );
}
