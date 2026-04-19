import { notFound } from "next/navigation";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import Session from "@/lib/models/Session";
import StatCard from "../../../components/dashboard/StatCard";
import ProjectTabs from "./ProjectTabs";

export default async function ProjectDetailPage({ params }) {
  const { projectId } = await params;
  await connectDB();

  let project;
  try {
    project = await Project.findById(projectId).lean();
  } catch {
    notFound();
  }
  if (!project) notFound();

  // Fetch sessions for this project
  const projectSessions = await Session.find({ project_id: project._id })
    .sort({ started_at: -1 })
    .limit(100)
    .lean();

  const completedSessions = projectSessions.filter((s) => s.status === "completed");
  const avgEngagement =
    completedSessions.length > 0
      ? Math.round(completedSessions.reduce((s, sess) => s + sess.engagement_score, 0) / completedSessions.length)
      : 0;

  const avgDurationSec =
    projectSessions.length > 0
      ? Math.round(projectSessions.reduce((s, sess) => s + (sess.duration_ms ?? 0) / 1000, 0) / projectSessions.length)
      : 0;

  const avgMissed =
    project.pages.length > 0
      ? Math.round(project.pages.reduce((s, p) => s + (p.missed_elements_pct ?? 0), 0) / project.pages.length)
      : 0;

  // Normalise sessions for the client component (serialize ObjectIds to strings)
  const sessionData = projectSessions.map((s) => ({
    sessionId: s.session_id,
    date: s.started_at?.toISOString() ?? null,
    duration: Math.round((s.duration_ms ?? 0) / 1000),
    engagementScore: s.engagement_score,
    pagesVisited: (s.pages_visited ?? []).map((p) => p.path),
    dataAccepted: s.data_accepted,
  }));

  const pageData = project.pages.map((p) => ({
    pageId: p._id.toString(),
    slug: p.slug,
    path: p.path,
    sessionCount: p.session_count ?? 0,
    avgFixation: p.avg_fixation_per_session ?? 0,
    missedPct: p.missed_elements_pct ?? 0,
    healthScore: p.health_score ?? 0,
  }));

  const minSec = Math.floor(avgDurationSec / 60);
  const secRem = avgDurationSec % 60;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{project.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{project.domain}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total sessions" value={(project.total_sessions ?? 0).toLocaleString()} icon="👁️" />
        <StatCard label="Avg engagement" value={avgEngagement} icon="💚" />
        <StatCard label="Avg missed elements" value={`${avgMissed}%`} icon="⚠️" />
        <StatCard
          label="Avg session time"
          value={`${minSec}:${secRem.toString().padStart(2, "0")}`}
          icon="⏱️"
        />
      </div>

      {/* Tabs */}
      <ProjectTabs
        projectId={projectId}
        pages={pageData}
        sessions={sessionData}
      />
    </div>
  );
}
