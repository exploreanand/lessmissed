import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import Project from "@/lib/models/Project";
import {
  normalizePath,
  slugFromTemplate,
  isWildcardTemplate,
  findMatchingPage,
} from "@/lib/pathTemplate";

// POST /api/extension/visits
// Body: { session_id, path, url, entered_at, referrer_path }
//
// Called once per page transition by the background worker — the two things
// that happen when a consumer moves to a new page, in one round trip:
//
//   1. resolve the page (auto-registering it if the site has one we've not seen)
//   2. close the previous visit and open this one on the session
//
// It used to also tell the extension whether the page needed a screenshot. It
// does not any more: captures are rendered server-side by capture-service
// against admin-configured target pages, never in a consumer's browser.
//
// Auto-registration lives here rather than in /api/extension/events on purpose:
// this fires once per page, that route fires several times a second.

// A site that generates URLs (search, filters, pagination) could otherwise grow
// Project.pages without bound. Past the cap we keep collecting events — they are
// still attributed by template — but stop adding rows to the project document.
const MAX_PAGES_PER_PROJECT = 200;
const SAMPLE_URL_LIMIT = 5;
export async function POST(request) {
  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { session_id, path, url, entered_at, referrer_path } = body;

  if (!session_id || !path) {
    return NextResponse.json({ error: "session_id and path are required" }, { status: 400 });
  }

  const session = await Session.findOne({ session_id });
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.status === "completed") {
    return NextResponse.json({ error: "Session already finalized" }, { status: 409 });
  }

  const project = await Project.findById(session.project_id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

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
      // ("/a/b" and "/a-b" both slug to "a-b"), and the slug is the dashboard's
      // page key — so disambiguate rather than overwrite.
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
        // Discovered pages hold no analysis until a session completes on them.
        status: "awaiting_data",
        discovered: true,
        first_seen_at: enteredAt,
      });
      page = project.pages[project.pages.length - 1];
    }
  }

  if (page) {
    page.last_seen_at = enteredAt;
    // Pages created before site-wide capture have no sample_urls array on disk.
    if (!Array.isArray(page.sample_urls)) page.sample_urls = [];
    if (url && page.sample_urls.length < SAMPLE_URL_LIMIT && !page.sample_urls.includes(url)) {
      page.sample_urls.push(url);
    }
    await project.save();
  }

  // The page's own path is the key everything downstream groups on — the flow
  // graph, the per-page session scoping, the rollup at finalize. For a client-
  // configured wildcard like "/blog/*" that is not the same string as the
  // computed "/blog/:id", and using the computed one would strand the visit
  // against a page row that never matches it.
  const template = page?.path ?? computedTemplate;

  // ── 2. Close the open visit, open this one ───────────────────────────────
  const visits = session.pages_visited ?? [];
  const open = [...visits].reverse().find((v) => !v.left_at);

  // A reload or a redirect back onto the same page is not a new visit — it would
  // otherwise show up in the flow graph as a self-loop on every page.
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
      referrer_template: referrer_path ? normalizePath(referrer_path) : open?.template ?? null,
    });
  }

  if (!session.entry_template) session.entry_template = template;
  session.exit_template = template;

  await session.save();

  return NextResponse.json({
    ok: true,
    template,
    capped,
    page_slug: page?.slug ?? null,
    page_discovered: page?.discovered ?? false,
  });
}
