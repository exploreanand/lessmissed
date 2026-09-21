// Page identity: which page is this URL?
//
// Site-wide tracking means we no longer know the page list up front — the
// extension reports whatever the consumer browses. Without templating, a store
// with 5000 products would register 5000 pages, each holding one session's worth
// of gaze data and none of them comparable. Templating collapses those into one
// row, "/products/:id", which is the unit a brand actually reasons about.
//
// This module is the single answer to that question. It is plain ESM with
// explicit .js imports so the backfill scripts can load it under bare Node,
// outside the Next bundler's "@/" alias — same constraint as deriveFixations.js
// and insights/regionMap.js.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 24-char Mongo ObjectIds, 32-char md5s, and anything else opaque and hex.
const HEX_ID_RE = /^[0-9a-f]{12,}$/i;
const ALL_DIGITS_RE = /^\d+$/;
// "nike-air-max-8812" / "8812-nike-air-max" — a human slug with an id welded on.
// Three digits minimum so "top-10" and "2024" style segments survive as content.
const TRAILING_ID_RE = /-\d{3,}$/;
const LEADING_ID_RE = /^\d{3,}-/;

// Segments whose *child* is a record id even when the id looks like a word.
// "/products/nike-air-max" carries no number, so no character-level rule can
// catch it, yet it is unmistakably one product among thousands. Every commerce
// and CMS platform uses one of these nouns, so the parent segment is the signal.
//
// Deliberately excluded: collection / category / c / shop. Those name a bounded
// set of merchandising pages — a brand has eight collections, not eight thousand,
// and wants "Summer" and "Winter" reported apart, not merged into one row.
const COLLECTION_SEGMENTS = new Set([
  "product", "products", "p", "item", "items", "sku", "dp",
  "post", "posts", "article", "articles", "blog", "news", "story", "stories",
  "user", "users", "profile", "profiles", "account", "accounts",
  "order", "orders", "invoice", "invoices", "listing", "listings",
]);

// Beyond this depth the tail stops carrying meaning worth a separate page row.
const MAX_SEGMENTS = 4;

/** Is this one segment a record identifier rather than a named page? */
function isDynamicSegment(segment, parentSegment) {
  if (!segment) return false;
  if (ALL_DIGITS_RE.test(segment)) return true;
  if (UUID_RE.test(segment)) return true;
  if (HEX_ID_RE.test(segment)) return true;
  if (TRAILING_ID_RE.test(segment)) return true;
  if (LEADING_ID_RE.test(segment)) return true;
  // A file, not a record: /about.html, /sitemap.xml.
  if (/\.[a-z0-9]{2,5}$/i.test(segment)) return false;
  if (parentSegment && COLLECTION_SEGMENTS.has(parentSegment.toLowerCase())) return true;
  return false;
}

/**
 * Reduce a URL or path to the page template it belongs to.
 *
 *   "/products/8812?ref=email"   → "/products/:id"
 *   "/products/nike-air-max"     → "/products/:id"
 *   "https://x.com/cart/"        → "/cart"
 *   "/a/b/c/d/e/f"               → "/a/b/c/d/*"
 *   ""                           → "/"
 *
 * Query strings and hashes are dropped: they vary per visit and are kept on the
 * raw event's page_url, not on page identity.
 */
export function normalizePath(rawUrlOrPath) {
  if (!rawUrlOrPath) return "/";

  let path = String(rawUrlOrPath);

  // Accept a full URL as readily as a bare path — callers have both.
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "/";
    }
  }

  path = path.split("#")[0].split("?")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  // Trailing slash is not a distinct page; "/" itself must survive the trim.
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "") return "/";

  const segments = path.split("/").filter(Boolean);
  if (!segments.length) return "/";

  const kept = [];
  let truncated = segments.length > MAX_SEGMENTS;

  for (let i = 0; i < Math.min(segments.length, MAX_SEGMENTS); i++) {
    const decoded = safeDecode(segments[i]);

    if (isDynamicSegment(decoded, segments[i - 1])) {
      kept.push(":id");

      // Everything past a record id, when it is more than one segment, is that
      // record's own sub-tree and not worth enumerating. This is what keeps a
      // date-partitioned blog — /blog/2024/05/my-post-title — from registering
      // one page per post, while leaving the useful single sub-view
      // (/products/:id/reviews) intact.
      const remaining = segments.length - (i + 1);
      if (remaining > 1) {
        truncated = true;
        break;
      }
      continue;
    }

    kept.push(decoded);
  }

  if (truncated) kept.push("*");

  return `/${kept.join("/")}`;
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Does this template contain a dynamic part, i.e. is it a wildcard page? */
export function isWildcardTemplate(template) {
  return String(template ?? "").includes(":") || String(template ?? "").includes("*");
}

/**
 * A filesystem- and URL-safe slug for a page template.
 *
 *   "/"              → "home"
 *   "/products/:id"  → "products-id"
 *   "/blog/*"        → "blog-all"
 *
 * Uses the whole path, unlike the setup wizard's original helper, which took
 * only the first segment and so gave "/products/a" and "/products/b" the same
 * slug — and with it the same screenshot and the same heatmap.
 */
export function slugFromTemplate(template) {
  const normalized = String(template ?? "/").replace(/\*/g, "all").replace(/:/g, "");
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "home";
}

/** Turn a stored page pattern into a regex source that matches raw paths. */
export function templateToRegexSource(template) {
  const escaped = String(template ?? "/")
    // Escape regex metacharacters, but leave our own ":" and "*" markers alone.
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    // ":id", ":slug", ":anything" — one path segment.
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "[^/]+")
    // "*" — the rest of the path.
    .replace(/\*/g, ".*");
  return `^${escaped}/?$`;
}

/**
 * Does a raw path belong to this configured page?
 *
 * Checks the pattern both ways: against the raw path (so "/products/8812"
 * matches a client-typed "/products/:id") and against the normalized template
 * (so a page auto-registered as "/products/:id" matches on identity).
 */
export function pathMatchesPage(rawPath, page) {
  if (!page?.path) return false;
  const path = String(rawPath ?? "").split("#")[0].split("?")[0] || "/";
  const template = normalizePath(path);

  if (page.path === path || page.path === template) return true;
  if (!isWildcardTemplate(page.path)) return false;

  try {
    return new RegExp(templateToRegexSource(page.path)).test(path);
  } catch {
    return false;
  }
}

/**
 * Mongo filter selecting the Events / Fixations that belong to a page.
 *
 * Both collections carry page_template as of the site-wide capture work; the
 * page_url clause is the fallback for documents written before it, and for
 * anything the backfill could not reach. Spread into a $match — callers do not
 * otherwise use $or.
 */
export function pageMatchFilter(page) {
  const template = page?.path ?? "/";
  const legacy = isWildcardTemplate(template)
    ? { page_url: { $regex: templateToRegexSource(template) } }
    : { page_url: template };

  return { $or: [{ page_template: template }, legacy] };
}

/**
 * Find the configured page a raw path belongs to, preferring the most specific
 * match — an exact "/products/sale" must win over a wildcard "/products/:id".
 */
export function findMatchingPage(pages, rawPath) {
  if (!Array.isArray(pages)) return null;
  const candidates = pages.filter((p) => pathMatchesPage(rawPath, p));
  if (!candidates.length) return null;
  return candidates.sort(
    (a, b) => Number(isWildcardTemplate(a.path)) - Number(isWildcardTemplate(b.path))
  )[0];
}
