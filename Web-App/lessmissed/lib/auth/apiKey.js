import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";

// Publishable-style tag keys. Format is `pk_<32 hex chars>` — the prefix is a
// human hint like Stripe's `pk_live_`, so a leaked-looking value on GitHub is
// recognisable as a Lessmissed tag key rather than a random hex blob.
const KEY_PREFIX = "pk_";
const KEY_BYTES = 16; // 32 hex chars — 128 bits of entropy

export function generateApiKey() {
  // crypto.randomUUID is available in every Node runtime we support, but its
  // output is 36 chars with dashes and encodes only 122 bits. Using randomBytes
  // gives us a clean 32-char hex string with a full 128 bits.
  // eslint-disable-next-line no-undef
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${KEY_PREFIX}${hex}`;
}

export function isValidKeyFormat(key) {
  return (
    typeof key === "string" &&
    key.startsWith(KEY_PREFIX) &&
    key.length === KEY_PREFIX.length + KEY_BYTES * 2
  );
}

// Extract the tag key from the request. Preferred is the header — a body or
// query parameter also works so `navigator.sendBeacon` (which doesn't set
// custom headers) can still auth on page unload flushes.
export function extractApiKey(request) {
  const header = request.headers.get("x-lessmissed-key");
  if (header) return header.trim();
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("key");
    if (q) return q.trim();
  } catch {
    /* ignore */
  }
  return null;
}

// Look up the project a key belongs to, subject to two invariants:
//   1. The key exists on some project's api_keys array.
//   2. That entry is not revoked.
//
// Returns { project, keyEntry } or null. The keyEntry is handed back so the
// caller can update `last_used_at` without a second query.
export async function findProjectByApiKey(key) {
  if (!isValidKeyFormat(key)) return null;
  await connectDB();

  const project = await Project.findOne({
    "api_keys.key": key,
    "api_keys.revoked_at": null,
    status: { $ne: "archived" },
  }).lean();

  if (!project) return null;
  const keyEntry = project.api_keys.find(
    (k) => k.key === key && !k.revoked_at
  );
  if (!keyEntry) return null;

  return { project, keyEntry };
}

// Origin allowlist. The request's Origin header must be under the project's
// registered domain (or a subdomain of it). The tag key is public, so the
// origin check is the real anti-abuse boundary here — without it, anyone with
// the key could post events from a browser on a site the brand does not own.
//
// Returns the matched allowed origin string (echoed back in
// Access-Control-Allow-Origin), or null when nothing matched. Missing Origin
// is treated as "not a browser fetch" — allowed only for API-side callers
// that pass no origin, which do not need CORS anyway.
export function originAllowedForProject(request, project) {
  const origin = request.headers.get("origin");
  if (!origin) return null; // no CORS to negotiate
  let hostname;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
  const registered = (project.domain ?? "").replace(/^www\./, "").toLowerCase();
  if (!registered) return null;
  const stripped = hostname.replace(/^www\./, "");
  if (stripped === registered || stripped.endsWith(`.${registered}`)) {
    return origin;
  }
  return null;
}

// Fire-and-forget bookkeeping. Updates last_used_at on the matched key so a
// brand can see which of their rotated keys is still active. Deliberately not
// awaited by the request handlers — a slow write here should not delay the
// hot path.
export function touchApiKey(project, keyEntry) {
  Project.updateOne(
    { _id: project._id, "api_keys._id": keyEntry._id },
    { $set: { "api_keys.$.last_used_at": new Date() } }
  ).catch(() => {
    /* best effort */
  });
}
