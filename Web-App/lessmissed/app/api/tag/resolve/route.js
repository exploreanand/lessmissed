import {
  handleTagPreflight,
  authenticateTagRequest,
  jsonWithCors,
} from "@/lib/tag/cors";

// GET /api/tag/resolve
// Bootstrap call from the head script. Authenticates via X-Lessmissed-Key,
// validates the request's Origin against the project's registered domain,
// and returns the project the tag should attach data to. Also hands back the
// pages array so the tag can resolve slugs client-side without another round
// trip.
export const OPTIONS = handleTagPreflight;

export async function GET(request) {
  const auth = await authenticateTagRequest(request);
  if (!auth.ok) return auth.response;

  const { project, cors } = auth;

  return jsonWithCors(
    {
      project_id: project._id.toString(),
      project_name: project.name,
      domain: project.domain,
      pages: (project.pages ?? []).map((p) => ({
        path: p.path,
        slug: p.slug,
      })),
    },
    200,
    cors
  );
}
