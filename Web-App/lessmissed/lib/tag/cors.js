import { NextResponse } from "next/server";
import {
  extractApiKey,
  findProjectByApiKey,
  originAllowedForProject,
  touchApiKey,
} from "@/lib/auth/apiKey";

// Which request headers the browser is allowed to send preflight-approved.
// X-Lessmissed-Key is our auth header; Content-Type is what fetch() adds for
// JSON bodies (and triggers a preflight). If we ever add a body-signing scheme
// its header goes here too.
const ALLOWED_HEADERS = "Content-Type, X-Lessmissed-Key";

// The set of methods the tag surface uses. GET for resolve, POST for creates,
// PATCH for the session finalize, OPTIONS for the preflight itself.
const ALLOWED_METHODS = "GET, POST, PATCH, OPTIONS";

// Long-lived preflight caching. 24h = the browser's max for most engines. This
// matters more than the request math suggests: without it, every batched
// events POST from the tag would preflight (JSON content-type triggers it),
// doubling the request count on the hot path.
const MAX_AGE = "86400";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
    // The Origin header influences the response — say so, or a shared cache
    // could hand a foo.com response back to a request from bar.com.
    Vary: "Origin",
  };
}

// Preflight handler. Two shapes:
//   1. Origin missing or unparseable → return 204 without CORS headers. The
//      browser will refuse the real request itself, no need for us to leak
//      whether the key was valid.
//   2. Origin present → look up the key and validate the origin. If both pass,
//      echo the origin back; else return without CORS headers.
//
// This handler is exported by each tag route file so Next.js registers it as
// the OPTIONS handler for that route.
export async function handleTagPreflight(request) {
  const origin = request.headers.get("origin");
  if (!origin) return new NextResponse(null, { status: 204 });

  const key = extractApiKey(request);
  if (!key) {
    // Origin is present but no key — return CORS headers without echoing
    // origin so the real request will fail cleanly with a CORS error rather
    // than 401. The tag would then know to prompt the brand to fix their
    // <script data-lm-key> attribute.
    return new NextResponse(null, { status: 204 });
  }

  const found = await findProjectByApiKey(key);
  if (!found) return new NextResponse(null, { status: 204 });

  const allowedOrigin = originAllowedForProject(request, found.project);
  if (!allowedOrigin) return new NextResponse(null, { status: 204 });

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(allowedOrigin),
  });
}

// Full request auth for a real (non-preflight) tag request. Returns either:
//   { ok: true, project, keyEntry, allowedOrigin, cors }
//   { ok: false, response }
//
// The `cors` field is a headers object the caller should merge into every
// response it returns from this request, so a successful body reply carries
// Access-Control-Allow-Origin. The `response` field on failure is a fully-
// formed NextResponse ready to return — 401 for missing/bad key, 403 for
// origin mismatch. Both failure responses include CORS headers so the browser
// can actually read the error body instead of hitting a CORS wall.
export async function authenticateTagRequest(request) {
  const key = extractApiKey(request);
  if (!key) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Missing X-Lessmissed-Key header" },
        { status: 401, headers: permissiveCorsForError(request) }
      ),
    };
  }

  const found = await findProjectByApiKey(key);
  if (!found) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or revoked key" },
        { status: 401, headers: permissiveCorsForError(request) }
      ),
    };
  }

  const allowedOrigin = originAllowedForProject(request, found.project);
  if (!allowedOrigin) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Origin not allowed for this project — must match the project's registered domain",
        },
        { status: 403, headers: permissiveCorsForError(request) }
      ),
    };
  }

  touchApiKey(found.project, found.keyEntry);

  return {
    ok: true,
    project: found.project,
    keyEntry: found.keyEntry,
    allowedOrigin,
    cors: corsHeaders(allowedOrigin),
  };
}

// For error responses only: echo the request Origin back so the browser can
// surface the actual error body to the tag script's console. Not appropriate
// for success responses (which should go through the full origin check). No
// credentials, no elevated methods — a leaked-origin echo here is a
// non-issue because the response body carries only an error message.
function permissiveCorsForError(request) {
  const origin = request.headers.get("origin");
  if (!origin) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

// Small ergonomic helper for handlers that want to merge cors into the JSON
// they're already returning: `return jsonWithCors({ ok: true }, 200, cors)`.
export function jsonWithCors(body, status, cors) {
  return NextResponse.json(body, { status, headers: cors });
}
