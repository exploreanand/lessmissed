import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import Event from "@/lib/models/Event";
import Fixation from "@/lib/models/Fixation";
import { deriveFixations } from "@/lib/deriveFixations";
import { computeSessionEngagement } from "@/lib/insights/engagement";
import { normalizePath, findMatchingPage } from "@/lib/pathTemplate";

/**
 * Give every visit the template it belongs to, resolved server-side.
 *
 * Page identity is the server's job, not the extension's — `/api/extension/events`
 * already says so, and `/api/extension/visits` already does it. This path did
 * not: it replaced the accumulated journey wholesale with the worker's copy,
 * which carries only `path`, `entered_at` and `left_at`. The result was that
 * *every* `pages_visited[].template` in the database was null, and with it:
 *
 *   - the rollup below filters on Boolean(template), so it incremented no
 *     session_count and never flipped a discovered page out of "awaiting_data"
 *   - the page view scopes sessions on `pages_visited.template`, which cannot
 *     match null, so every page reported zero sessions
 *   - exit_template, read back off the replaced array, was null too
 *
 * Re-resolving here rather than trusting the payload also repairs sessions sent
 * by extension builds already installed, which will keep sending the old shape
 * for as long as they go un-updated.
 *
 * Prefers the matched page's own `path` over the computed template: a client
 * configured "/blog/*" is not the string "/blog/:id", and using the computed one
 * would strand the visit against a page row that never matches it.
 */
function resolveVisitTemplate(pages, rawPath) {
  return findMatchingPage(pages, rawPath)?.path ?? normalizePath(rawPath);
}

// Allow up to 60 seconds for fixation derivation on large sessions
export const maxDuration = 60;

/**
 * Attribute each fixation / click / scroll to the page visit it happened during.
 *
 * Bucketing by time window rather than by page_url is what makes revisits work:
 * a session that goes product → cart → the same product has two visits to one
 * path, and grouping on the path alone would pile both into whichever entry came
 * first. Site-wide sessions revisit constantly, so this is the common case.
 */
async function attributeVisitCounters(sessionId, visits, endedAt) {
  if (!visits.length) return;

  const [fixations, events] = await Promise.all([
    Fixation.find({ session_id: sessionId }).select("start_timestamp").lean(),
    Event.find({ session_id: sessionId, type: { $in: ["click", "scroll"] } })
      .select("timestamp type data.depth_pct")
      .lean(),
  ]);

  // Windows are half-open [entered_at, left_at); the last visit runs to the end
  // of the session, since nothing closed it.
  const windows = visits.map((v, i) => ({
    visit: v,
    from: new Date(v.entered_at ?? 0).getTime(),
    to: new Date(v.left_at ?? (i === visits.length - 1 ? endedAt : v.entered_at)).getTime(),
  }));

  const findWindow = (ts) => {
    const t = new Date(ts).getTime();
    return windows.find((w) => t >= w.from && t < w.to) ?? null;
  };

  for (const v of visits) {
    v.fixation_count = 0;
    v.click_count = 0;
    v.max_scroll_depth_percent = 0;
  }

  for (const f of fixations) {
    const w = findWindow(f.start_timestamp);
    if (w) w.visit.fixation_count += 1;
  }

  for (const e of events) {
    const w = findWindow(e.timestamp);
    if (!w) continue;
    if (e.type === "click") {
      w.visit.click_count += 1;
    } else if (e.data?.depth_pct != null) {
      w.visit.max_scroll_depth_percent = Math.max(
        w.visit.max_scroll_depth_percent,
        e.data.depth_pct
      );
    }
  }
}

// PATCH /api/extension/sessions/:id
// Body: { ended_at?, pages_visited?, max_scroll_depth_pct? }
//
// With `ended_at` this finalises the session: closes the open page visit, fills
// in per-visit counters, derives fixations and rolls the visit up onto each
// page. Without it, this is a partial update — the background worker uses that
// to checkpoint a long session's journey without ending it.
export async function PATCH(request, { params }) {
  await connectDB();

  const { id: session_id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { ended_at, pages_visited, max_scroll_depth_pct } = body;

  const session = await Session.findOne({ session_id });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status === "completed") {
    return NextResponse.json({ ok: true, already_finalized: true });
  }

  // The background worker holds the authoritative journey — it is the only
  // thing that survives a navigation — so an explicit pages_visited replaces
  // what the visits endpoint accumulated. But the worker does not know page
  // identity, so the template is resolved here rather than taken from it, and
  // anything the visits endpoint already worked out for the same visit is kept.
  if (Array.isArray(pages_visited) && pages_visited.length) {
    const project = await Project.findById(session.project_id).select("pages").lean();
    const pages = project?.pages ?? [];
    const previous = session.pages_visited ?? [];

    session.pages_visited = pages_visited.map((visit) => {
      const path = visit.path ?? "/";
      // Match on path + entry time so a session that revisits one page keeps
      // each visit's own record rather than collapsing them.
      const known = previous.find(
        (p) =>
          p.path === path &&
          String(p.entered_at ?? "") === String(visit.entered_at ?? "")
      );

      return {
        ...(known ? known.toObject?.() ?? known : {}),
        ...visit,
        template: visit.template ?? known?.template ?? resolveVisitTemplate(pages, path),
      };
    });
  }
  if (max_scroll_depth_pct != null) {
    session.summary.max_scroll_depth_percent = max_scroll_depth_pct;
  }

  // ── Partial checkpoint — journey saved, session stays open ────────────────
  if (!ended_at) {
    await session.save();
    return NextResponse.json({ ok: true, finalized: false });
  }

  // ── Finalise ─────────────────────────────────────────────────────────────
  const endedAt = new Date(ended_at);

  // Backstop: any visit still missing a template gets one now. Covers journeys
  // accumulated before this fix, and any path that reached pages_visited without
  // going through the visits endpoint.
  const missingTemplate = session.pages_visited.filter((v) => !v.template);
  if (missingTemplate.length) {
    const project = await Project.findById(session.project_id).select("pages").lean();
    const pages = project?.pages ?? [];
    for (const visit of missingTemplate) {
      visit.template = resolveVisitTemplate(pages, visit.path ?? "/");
    }
  }

  if (!session.entry_template && session.pages_visited.length) {
    session.entry_template = session.pages_visited[0].template;
  }

  // Close whatever page they were on when they stopped.
  const open = [...session.pages_visited].reverse().find((v) => !v.left_at);
  if (open) {
    open.left_at = endedAt;
    open.dwell_ms = Math.max(0, endedAt - new Date(open.entered_at ?? endedAt));
  }
  if (session.pages_visited.length) {
    session.exit_template = session.pages_visited.at(-1).template;
  }

  session.status = "completed";
  session.ended_at = endedAt;
  session.duration_ms = Math.max(0, endedAt - new Date(session.started_at));

  // Derive fixations before attributing counters — the per-visit fixation_count
  // is read straight back out of the collection this writes.
  let fixation_count = 0;
  try {
    fixation_count = await deriveFixations(session_id, session.project_id.toString());
  } catch (err) {
    // Non-fatal: fixations can be re-derived later
    console.error("[deriveFixations] failed for session", session_id, err.message);
  }

  try {
    await attributeVisitCounters(session_id, session.pages_visited, endedAt);
  } catch (err) {
    console.error("[attributeVisitCounters] failed for session", session_id, err.message);
  }

  // Engagement score, SRS §6 — computed here, after fixations exist, because
  // four of its five signals are read from them. This field used to be set to
  // 0 when the session was created and never touched again, so every
  // "Avg engagement" figure in the product was a placeholder.
  //
  // FR-L2-09 says insights should use only sessions scoring 60 or more. That
  // gate is deliberately not applied yet: current sessions are short test
  // browses, and enforcing it would empty every page's dashboard.
  try {
    const { score, breakdown } = await computeSessionEngagement(
      session_id,
      session.project_id.toString()
    );
    session.engagement_score = score;
    session.engagement_breakdown = breakdown;
  } catch (err) {
    console.error("[engagement] failed for session", session_id, err.message);
  }

  await session.save();

  // Roll the session up onto each distinct page it touched. Matching on the
  // template rather than the raw path is what makes this work across a site:
  // a session that opened four products increments "/products/:id" once.
  const templates = [
    ...new Set(session.pages_visited.map((p) => p.template).filter(Boolean)),
  ];

  await Promise.all(
    templates.flatMap((template) => [
      Project.updateOne(
        { _id: session.project_id, "pages.path": template },
        {
          $inc: { "pages.$.session_count": 1 },
          $set: { "pages.$.last_session_at": endedAt },
        }
      ),
      // A discovered page sits at "awaiting_data" until it has a completed
      // session behind it; now it has one. Scoped to that status so this never
      // resurrects a page the client deliberately paused.
      Project.updateOne(
        {
          _id: session.project_id,
          pages: { $elemMatch: { path: template, status: "awaiting_data" } },
        },
        { $set: { "pages.$.status": "active" } }
      ),
    ])
  );

  return NextResponse.json({ ok: true, fixation_count, pages: templates.length });
}
