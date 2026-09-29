import { NextResponse } from "next/server";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";
import { generateApiKey } from "@/lib/auth/apiKey";

// GET /api/projects/:id/api-keys
// Owner-only. Lists non-revoked keys for the project — full plaintext
// included, because these are publishable-style keys the brand embeds in a
// <script> tag and needs to be able to copy from the dashboard at any time.
export async function GET(_request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const keys = (project.api_keys ?? [])
    .filter((k) => !k.revoked_at)
    .map((k) => ({
      _id: k._id.toString(),
      key: k.key,
      name: k.name,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
    }));

  return NextResponse.json({ keys });
}

// POST /api/projects/:id/api-keys  { name? }
// Owner-only. Mints a fresh publishable key and appends it to the project.
// Returns the full key one time — same as any dashboard shows on creation.
// Multiple keys can be live at once so a brand can rotate without downtime.
export async function POST(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const owned = await getOwnedProject(id, user);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty body OK */
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : null;

  const key = generateApiKey();

  try {
    // Load the hydrated doc so pushing into api_keys runs the subdoc's
    // default _id generator — findByIdAndUpdate with $push skips schema
    // defaults on the pushed subdoc, which meant the created row had no _id
    // and my old projection trick returned nothing.
    const project = await Project.findById(owned._id);
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    project.api_keys.push({
      key,
      name,
      created_at: new Date(),
      last_used_at: null,
      revoked_at: null,
    });
    await project.save();

    const created = project.api_keys[project.api_keys.length - 1];
    return NextResponse.json(
      {
        _id: created._id.toString(),
        key: created.key,
        name: created.name,
        created_at: created.created_at,
        last_used_at: created.last_used_at,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[api-keys POST] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to create key" },
      { status: 500 }
    );
  }
}
