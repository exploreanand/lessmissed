import { NextResponse } from "next/server";
import Session from "@/lib/models/Session";
import { getSessionUser } from "@/lib/auth/session";
import { getOwnedProject } from "@/lib/auth/ownership";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/flow
// Query: limit (sessions to consider, default 1000), status (default completed)
//
// The page-to-page journey, built from Session.pages_visited. Only possible now
// that a session spans a whole site: it used to hold the entry page and nothing
// else, which is why this view was hardcoded sample data.
export async function GET(request, { params }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const project = await getOwnedProject(id, user);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 1000), 5000);
  const status = searchParams.get("status") ?? "completed";

  const sessions = await Session.find({
    project_id: project._id,
    ...(status === "all" ? {} : { status }),
  })
    .sort({ started_at: -1 })
    .limit(limit)
    .select("session_id pages_visited")
    .lean();

  const slugByTemplate = new Map((project.pages ?? []).map((p) => [p.path, p.slug]));

  // Templates are percent-decoded, so they can contain spaces and arrows. Join
  // composite map keys on NUL, which a URL path cannot carry.
  const SEP = "\u0000";

  const nodes = new Map();
  const edges = new Map();
  const pathCounts = new Map();

  const nodeFor = (template) => {
    if (!nodes.has(template)) {
      nodes.set(template, {
        template,
        slug: slugByTemplate.get(template) ?? null,
        sessions: 0,
        visits: 0,
        entries: 0,
        exits: 0,
        total_dwell_ms: 0,
        total_fixations: 0,
        total_clicks: 0,
      });
    }
    return nodes.get(template);
  };

  for (const session of sessions) {
    // Collapse consecutive repeats: a reload or a redirect is the same page, and
    // rendering it as a self-loop would bury the journey in noise.
    const journey = [];
    for (const visit of session.pages_visited ?? []) {
      const template = visit.template ?? visit.path;
      if (!template) continue;
      if (journey.length && journey.at(-1).template === template) {
        // Fold the repeat into the visit already recorded.
        journey.at(-1).dwell_ms += visit.dwell_ms ?? 0;
        journey.at(-1).fixation_count += visit.fixation_count ?? 0;
        journey.at(-1).click_count += visit.click_count ?? 0;
        continue;
      }
      journey.push({
        template,
        dwell_ms: visit.dwell_ms ?? 0,
        fixation_count: visit.fixation_count ?? 0,
        click_count: visit.click_count ?? 0,
      });
    }

    if (!journey.length) continue;

    // "Sessions" on a node counts each session once even if it came back twice —
    // that is the number a brand reads as reach.
    const seen = new Set();

    journey.forEach((step, i) => {
      const node = nodeFor(step.template);
      node.visits += 1;
      node.total_dwell_ms += step.dwell_ms;
      node.total_fixations += step.fixation_count;
      node.total_clicks += step.click_count;

      if (!seen.has(step.template)) {
        seen.add(step.template);
        node.sessions += 1;
      }
      if (i === 0) node.entries += 1;
      if (i === journey.length - 1) node.exits += 1;

      if (i > 0) {
        const key = `${journey[i - 1].template}${SEP}${step.template}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    });

    const pathKey = journey.map((s) => s.template).join(SEP);
    pathCounts.set(pathKey, (pathCounts.get(pathKey) ?? 0) + 1);
  }

  const nodeList = [...nodes.values()]
    .map((n) => ({
      template: n.template,
      slug: n.slug,
      sessions: n.sessions,
      visits: n.visits,
      entries: n.entries,
      exits: n.exits,
      // Share of sessions that reached this page and went no further — the
      // drop-off a brand actually acts on.
      exit_rate: n.sessions > 0 ? Math.round((n.exits / n.sessions) * 100) : 0,
      avg_dwell_ms: n.visits > 0 ? Math.round(n.total_dwell_ms / n.visits) : 0,
      avg_fixations: n.visits > 0 ? Math.round(n.total_fixations / n.visits) : 0,
      avg_clicks: n.visits > 0 ? Math.round((n.total_clicks / n.visits) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const edgeList = [...edges.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split(SEP);
      return { from, to, sessions: count };
    })
    .sort((a, b) => b.sessions - a.sessions);

  const topPaths = [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => ({ path: path.split(SEP), sessions: count }));

  return NextResponse.json({
    total_sessions: sessions.length,
    nodes: nodeList,
    edges: edgeList,
    top_paths: topPaths,
  });
}
