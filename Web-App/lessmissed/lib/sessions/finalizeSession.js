import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import Event from "@/lib/models/Event";
import Fixation from "@/lib/models/Fixation";
import { deriveFixations } from "@/lib/deriveFixations";
import { computeSessionEngagement } from "@/lib/insights/engagement";
import { normalizePath, findMatchingPage } from "@/lib/pathTemplate";

// Shared finalize path used by both /api/extension/sessions/[id] PATCH and
// /api/tag/sessions/[id] PATCH. Kept here because the two ingest surfaces
// have different auth models but identical finalize semantics, and letting
// the logic drift would silently produce different engagement numbers for
// sessions ingested through the two paths.

/**
 * Give every visit the template it belongs to. Page identity is the server's
 * job — the ingesting client only knows the raw path — so we look up the
 * template from Project.pages and prefer the matched page's own `path` over
 * the computed template (a client-configured "/blog/*" is not the same
 * string as the computed "/blog/:id").
 */
export function resolveVisitTemplate(pages, rawPath) {
  return findMatchingPage(pages, rawPath)?.path ?? normalizePath(rawPath);
}

/**
 * Attribute each fixation / click / scroll to the page visit it happened
 * during. Bucketing by time window rather than by page_url is what makes
 * revisits work: a session that goes product → cart → the same product has
 * two visits to one path, and grouping by path alone would pile both into
 * whichever entry came first. Site-wide sessions revisit constantly.
 *
 * Windows are half-open [entered_at, left_at); the last visit runs to the
 * end of the session, since nothing closed it.
 */
export async function attributeVisitCounters(sessionId, visits, endedAt) {
  if (!visits.length) return;

  const [fixations, events] = await Promise.all([
    Fixation.find({ session_id: sessionId }).select("start_timestamp").lean(),
    Event.find({ session_id: sessionId, type: { $in: ["click", "scroll"] } })
      .select("timestamp type data.depth_pct")
      .lean(),
  ]);

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

/**
 * Everything from "close the open visit" through "roll session counters up
 * onto each distinct page". Assumes the session's pages_visited is already
 * hydrated with template values — call resolveVisitTemplate for any missing
 * ones before calling this.
 *
 * Returns { fixation_count, pages_touched } for the response body.
 */
export async function finalizeSessionAndRollup(session, endedAtDate) {
  const endedAt = endedAtDate;

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

  // Fixations first — per-visit fixation_count reads straight out of the
  // collection this writes.
  let fixation_count = 0;
  try {
    fixation_count = await deriveFixations(
      session.session_id,
      session.project_id.toString()
    );
  } catch (err) {
    console.error("[deriveFixations] failed for session", session.session_id, err.message);
  }

  try {
    await attributeVisitCounters(session.session_id, session.pages_visited, endedAt);
  } catch (err) {
    console.error("[attributeVisitCounters] failed", session.session_id, err.message);
  }

  // Engagement score, SRS §6 — computed here, after fixations exist, because
  // four of its five signals are read from them.
  try {
    const { score, breakdown } = await computeSessionEngagement(
      session.session_id,
      session.project_id.toString()
    );
    session.engagement_score = score;
    session.engagement_breakdown = breakdown;
  } catch (err) {
    console.error("[engagement] failed for session", session.session_id, err.message);
  }

  await session.save();

  // Roll the session up onto each distinct page it touched. Matching on
  // template rather than raw path is what makes this correct across a site:
  // one session that opened four products increments "/products/:id" once.
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
      // Discovered pages sit at "awaiting_data" until a completed session
      // exists for them. Scoped to that status so this never resurrects a
      // page a client deliberately paused.
      Project.updateOne(
        {
          _id: session.project_id,
          pages: { $elemMatch: { path: template, status: "awaiting_data" } },
        },
        { $set: { "pages.$.status": "active" } }
      ),
    ])
  );

  return { fixation_count, pages_touched: templates.length };
}

/**
 * Merge a client-supplied pages_visited into the session, preserving whatever
 * the visits endpoint has already worked out for each visit and letting the
 * client's copy fill anything missing.
 *
 * The background worker (or the tag) holds the authoritative journey — it is
 * the only thing that survives a navigation — so an explicit pages_visited
 * replaces what the visits endpoint accumulated. But it does not know page
 * identity, so the template is resolved here rather than trusted.
 */
export async function applyPagesVisitedUpdate(session, pages_visited) {
  if (!Array.isArray(pages_visited) || !pages_visited.length) return;

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
      template:
        visit.template ?? known?.template ?? resolveVisitTemplate(pages, path),
    };
  });
}

/**
 * Backstop: any visit still missing a template gets one. Covers journeys
 * accumulated before pages_visited templating was introduced, and any path
 * that reached the array without going through the visits endpoint.
 */
export async function backfillMissingTemplates(session) {
  const missing = session.pages_visited.filter((v) => !v.template);
  if (!missing.length) return;
  const project = await Project.findById(session.project_id).select("pages").lean();
  const pages = project?.pages ?? [];
  for (const visit of missing) {
    visit.template = resolveVisitTemplate(pages, visit.path ?? "/");
  }
}
