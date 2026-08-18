import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";

// Returns the project only if it exists AND belongs to the current user; else null.
// "Missing" and "not yours" both return null on purpose so callers answer 404 either
// way and never leak whether another account's project exists.
// Pass an already-resolved `user` to avoid a second session lookup.
export async function getOwnedProject(projectId, user = null) {
  const sessionUser = user ?? (await getSessionUser());
  if (!sessionUser) return null;

  await connectDB();
  let project;
  try {
    project = await Project.findById(projectId).lean();
  } catch {
    return null; // malformed ObjectId
  }
  if (!project) return null;
  if (project.client_id.toString() !== sessionUser.userId) return null;
  return project;
}
