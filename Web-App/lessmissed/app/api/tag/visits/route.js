import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import {
  normalizePath,
  slugFromTemplate,
  isWildcardTemplate,
  findMatchingPage,
} from "@/lib/pathTemplate";
import { handleTagPreflight, authenticateTagRequest, jsonWithCors } from "@/lib/tag/cors";

// POST /api/tag/visits
// Body: { session_id, path, url, entered_at, referrer_path }
//
// Mirror of /api/extension/visits. Fires once per page transition — the tag's
// history-patching detects both hard loads and SPA navs and posts here to
// register the page (auto-discovering it if new) and roll the session's
// journey forward. Any changes to page-discovery caps belong in both this
// route and the extension one until we extract a shared helper.

// A site that generates URLs (search, filters, pagination) could grow
// Project.pages without bound. Past the cap we keep collecting events —
// they're still attributed by template — but stop adding page rows.
const MAX_PAGES_PER_PROJECT = 200;
const SAMPLE_URL_LIMIT = 5;

export const OPTIONS = handleTagPreflight;

export async function POST(request) {
  const auth = await authenticateTagRequest(request);
  if (!auth.ok) return auth.response;
  const { project: tagProject, cors } = auth;

  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ error: "Invalid JSON" }, 400, cors);
  }

  const { session_id, path, url, entered_at, referrer_path } = body;

  if (!session_id || !path) {
    return jsonWithCors({ error: "session_id and path are required" }, 400, cors);
  }

  const session = await Session.findOne({ session_id });
  if (!session) return jsonWithCors({ error: "Session not found" }, 404, cors);
  if (session.status === "completed") {
    return jsonWithCors({ error: "Session already finalized" }, 409, cors);
  }
  if (session.project_id.toString() !== tagProject._id.toString()) {
    return jsonWithCors({ error: "Session belongs to a different project" }, 403, cors);
  }

  // Re-read the project as a hydrated doc so subdoc mutations save cleanly.
  const project = await Project.findById(session.project_id);
  if (!project) return jsonWithCors({ error: "Project not found" }, 404, cors);

  const computedTemplate = normalizePath(path);
  const enteredAt = new Date(entered_at ?? Date.now());

  // ── 1. Resolve or register the page ──────────────────────────────────────
  let page = findMatchingPage(project.pages, path);
  let capped = false;

  if (!page) {
    if (project.pages.length >= MAX_PAGES_PER_PROJECT) {
      capped = true;
    } else {
      // Slug collisions are possible across differently-shaped templates
      // ("/a/b" and "/a-b" both slug to "a-b"). Disambiguate rather than
      // overwrite.
      const takenSlugs = new Set(project.pages.map((p) => p.slug));
      let slug = slugFromTemplate(computedTemplate);
      if (takenSlugs.has(slug)) {
        let n = 2;
        while (takenSlugs.has(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }

      project.pages.push({
        path: computedTemplate,
        slug,
        type: isWildcardTemplate(computedTemplate) ? "wildcard" : "exact",
        status: "awaiting_data",
        discovered: true,
        first_seen_at: enteredAt,
      });
      page = project.pages[project.pages.length - 1];
    }
  }

  if (page) {
    page.last_seen_at = enteredAt;
    if (!Array.isArray(page.sample_urls)) page.sample_urls = [];
    if (
      url &&
      page.sample_urls.length < SAMPLE_URL_LIMIT &&
      !page.sample_urls.includes(url)
    ) {
      page.sample_urls.push(url);
    }
    await project.save();
  }

  const template = page?.path ?? computedTemplate;

  // ── 2. Close the open visit, open this one ───────────────────────────────
  const visits = session.pages_visited ?? [];
  const open = [...visits].reverse().find((v) => !v.left_at);
  // A reload or same-page redirect isn't a new visit — it would otherwise
  // show as a self-loop on every page in the flow graph.
  const isSamePage = open && open.path === path;

  if (open && !isSamePage) {
    open.left_at = enteredAt;
    open.dwell_ms = Math.max(0, enteredAt - new Date(open.entered_at ?? enteredAt));
  }

  if (!isSamePage) {
    session.pages_visited.push({
      path,
      template,
      entered_at: enteredAt,
      referrer_template: referrer_path
        ? normalizePath(referrer_path)
        : open?.template ?? null,
    });
  }

  if (!session.entry_template) session.entry_template = template;
  session.exit_template = template;

  await session.save();

  return jsonWithCors(
    {
      ok: true,
      template,
      capped,
      page_slug: page?.slug ?? null,
      page_discovered: page?.discovered ?? false,
    },
    200,
    cors
  );
}
