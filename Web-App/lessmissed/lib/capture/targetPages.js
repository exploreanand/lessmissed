// Adding and promoting target pages.
//
// The substance of POST /api/projects/:id/pages lives here rather than in the
// route so it can be tested without an HTTP server or a session cookie. The
// route keeps what only a route can do: authenticate, and turn a typed failure
// into a status code.
//
// Relative imports, no "@/" alias, so tests and scripts can load it under bare
// Node — the same constraint pathTemplate.js works under.

import mongoose from "mongoose";
import Project from "../models/Project.js";
import { normalizePath, slugFromTemplate, isWildcardTemplate } from "../pathTemplate.js";
import { assertSafeUrl, UnsafeUrlError } from "./urlSafety.js";
import { enqueueCapture } from "./enqueue.js";
import { isValidBreakpoint } from "./breakpoints.js";

// Matches the guard the visits endpoint already applies, so a project cannot
// grow an unbounded pages array from either direction.
export const MAX_PAGES_PER_PROJECT = 200;

export class TargetPageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "TargetPageError";
    this.status = status;
  }
}

/**
 * Register a URL as a tracked target page and queue its baseline capture.
 *
 * @param {object} args
 * @param {object} args.project a lean Project document
 * @param {string} args.url whatever the admin typed
 * @param {string[]} [args.breakpoints]
 * @param {string[]} [args.maskSelectors]
 * @param {string[]} [args.dismissSelectors]
 * @returns {Promise<{page: object, queued: object[], created: boolean}>}
 */
export async function addTargetPage({
  project,
  url,
  breakpoints,
  maskSelectors,
  dismissSelectors,
}) {
  if (!url || typeof url !== "string" || !url.trim()) {
    throw new TargetPageError("A page URL is required");
  }

  const candidate = toAbsoluteUrl(url, project.domain);
  if (!candidate) throw new TargetPageError(`Could not read "${url}" as a URL`);

  let safe;
  try {
    safe = await assertSafeUrl(candidate, { expectedHostname: project.domain });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new TargetPageError(explain(err, project.domain));
    throw err;
  }

  const requested =
    Array.isArray(breakpoints) && breakpoints.length ? breakpoints : ["desktop"];
  const invalid = requested.filter((b) => !isValidBreakpoint(b));
  if (invalid.length) {
    throw new TargetPageError(`Unknown breakpoint(s): ${invalid.join(", ")}`);
  }

  const template = normalizePath(safe.url.pathname);
  const pages = project.pages ?? [];
  const existing = pages.find((p) => p.path === template);

  // A page the extension already discovered is promoted in place. Creating a
  // second row for the same template would split its gaze data across two
  // pages, and neither would show the whole picture.
  if (existing) {
    const promoted = await promoteExisting(project._id, existing, {
      captureUrl: safe.url.toString(),
      breakpoints: requested,
      maskSelectors,
      dismissSelectors,
    });
    const queued = await queueBaselines(project._id, existing._id, requested);
    return { page: promoted, queued, created: false };
  }

  if (pages.length >= MAX_PAGES_PER_PROJECT) {
    throw new TargetPageError(
      `This project already tracks ${MAX_PAGES_PER_PROJECT} pages`,
      409
    );
  }

  const page = {
    _id: new mongoose.Types.ObjectId(),
    path: template,
    slug: uniqueSlug(slugFromTemplate(template), pages),
    type: isWildcardTemplate(template) ? "wildcard" : "exact",
    status: "active",
    target: true,
    approval_status: "approved",
    capture_url: safe.url.toString(),
    capture_breakpoints: requested,
    mask_selectors: sanitiseSelectors(maskSelectors),
    dismiss_selectors: sanitiseSelectors(dismissSelectors),
    screenshot_status: "queued",
    added_at: new Date(),
    sample_urls: [safe.url.toString()],
  };

  await Project.updateOne({ _id: project._id }, { $push: { pages: page } });
  const queued = await queueBaselines(project._id, page._id, requested);

  return { page, queued, created: true };
}

async function queueBaselines(projectId, pageId, breakpoints) {
  const results = [];
  for (const breakpoint of breakpoints) {
    const { created } = await enqueueCapture({
      projectId,
      pageId,
      breakpoint,
      reason: "baseline",
    });
    results.push({ breakpoint, created });
  }
  return results;
}

async function promoteExisting(projectId, page, options) {
  const set = {
    "pages.$.target": true,
    "pages.$.approval_status": "approved",
    "pages.$.capture_url": options.captureUrl,
    "pages.$.capture_breakpoints": options.breakpoints,
    "pages.$.screenshot_status": "queued",
  };
  if (options.maskSelectors !== undefined) {
    set["pages.$.mask_selectors"] = sanitiseSelectors(options.maskSelectors);
  }
  if (options.dismissSelectors !== undefined) {
    set["pages.$.dismiss_selectors"] = sanitiseSelectors(options.dismissSelectors);
  }

  await Project.updateOne({ _id: projectId, "pages._id": page._id }, { $set: set });

  const applied = {};
  for (const [key, value] of Object.entries(set)) {
    applied[key.replace("pages.$.", "")] = value;
  }
  return { ...page, ...applied };
}

/**
 * Build an absolute URL from whatever the admin supplied.
 *
 * Accepts a full URL, a bare host+path, or a path. The setup wizard's original
 * parser kept only lines starting with "/", so pasting the URL out of the
 * browser bar — the single most likely thing an admin does — silently added
 * nothing and reported no error.
 */
export function toAbsoluteUrl(input, domain) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).toString();
    if (raw.startsWith("/")) return new URL(raw, `https://${domain}`).toString();
    return new URL(`https://${raw}`).toString();
  } catch {
    return null;
  }
}

/** Turn a guard failure into something an admin can act on. */
function explain(err, domain) {
  switch (err.code) {
    case "wrong_origin":
      return `That URL is not on ${domain}. Target pages must belong to this project's site.`;
    case "blocked_address":
      return "That URL points at a private or internal address, which cannot be captured.";
    case "dns_failure":
      return "That domain could not be resolved. Check the address and try again.";
    case "bad_protocol":
      return "Only http and https pages can be captured.";
    case "credentials_in_url":
      return "Remove the username and password from the URL.";
    default:
      return err.message;
  }
}

/** Selectors are injected into the rendered page; keep them short and few. */
export function sanitiseSelectors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, 50);
}

export function uniqueSlug(base, pages) {
  const taken = new Set(pages.map((p) => p.slug));
  // "-header" is reserved: the legacy path stores a page's sticky nav at
  // "<slug>-header.jpg", so a page slugged that way would collide with it.
  if (!taken.has(base) && !base.endsWith("-header")) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Shape a page subdocument for the dashboard. */
export function summarisePage(page) {
  return {
    id: String(page._id),
    path: page.path,
    slug: page.slug,
    target: Boolean(page.target),
    approval_status: page.approval_status ?? "pending",
    discovered: Boolean(page.discovered),
    capture_url: page.capture_url ?? null,
    capture_breakpoints: page.capture_breakpoints ?? ["desktop"],
    mask_selectors: page.mask_selectors ?? [],
    dismiss_selectors: page.dismiss_selectors ?? [],
    screenshot_status: page.screenshot_status ?? "none",
    screenshot_url: page.screenshot_url ?? null,
    screenshot_captured_at: page.screenshot_captured_at ?? null,
    availability_status: page.availability_status ?? "ok",
    availability_error: page.availability_error ?? null,
    sample_urls: page.sample_urls ?? [],
    session_count: page.session_count ?? 0,
    last_seen_at: page.last_seen_at ?? null,
    last_session_at: page.last_session_at ?? null,
    is_wildcard: isWildcardTemplate(page.path),
  };
}
