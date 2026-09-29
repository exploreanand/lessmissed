import { NextResponse } from "next/server";
import mongoose from "mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

// DELETE /api/projects/:id/api-keys/:keyId
// Owner-only. Soft-revokes the key by stamping revoked_at rather than pulling
// it — revocation history lets us tell "no key" from "used to have one",
// which matters when debugging why a brand's tag suddenly stopped posting.
export async function DELETE(_request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id, keyId } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!mongoose.isValidObjectId(keyId)) {
    return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
  }

  const result = await Project.updateOne(
    {
      _id: project._id,
      "api_keys._id": keyId,
      "api_keys.revoked_at": null,
    },
    { $set: { "api_keys.$.revoked_at": new Date() } }
  );

  if (result.matchedCount === 0) {
    return NextResponse.json(
      { error: "Key not found or already revoked" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
