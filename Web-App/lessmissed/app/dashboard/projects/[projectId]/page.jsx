import { notFound } from "next/navigation";
import Session from "@/lib/models/Session";
import { getOwnedProject } from "@/lib/auth/ownership";
import StatCard from "../../../components/dashboard/StatCard";
import { loadMetricsForPages } from "@/lib/insights/pageMetrics";
import ProjectTabs from "./ProjectTabs";

export default async function ProjectDetailPage({ params }) {
  const { projectId } = await params;

  const project = await getOwnedProject(projectId);
  if (!project) notFound();

  // Fetch sessions for this project
  const projectSessions = await Session.find({ project_id: project._id })
    .sort({ started_at: -1 })
    .limit(100)
    .lean();

  const completedSessions = projectSessions.filter((s) => s.status === "completed");
  // Real since engagement is computed at finalize (SRS §6). Before that the
  // field was hard-coded to 0 at session creation, so this card read 0 always.
  const avgEngagement =
    completedSessions.length > 0
      ? Math.round(
          completedSessions.reduce((s, sess) => s + (sess.engagement_score ?? 0), 0) /
            completedSessions.length
        )
      : null;

  const avgDurationSec =
    projectSessions.length > 0
      ? Math.round(projectSessions.reduce((s, sess) => s + (sess.duration_ms ?? 0) / 1000, 0) / projectSessions.length)
      : 0;

  // Target pages only — the ones this project captures and reports on.
  // Discovered pages are suggestions until an admin adds them.
  const targets = project.pages.filter((p) => p.target);

  // Averaged from computed per-page values. This used to average
  // missed_elements_pct, a field nothing ever wrote, so it read 0% on every
  // project. Pages whose missed % is unknown are left out rather than counted
  // as 0, which would flatter the average.
  const metrics = await loadMetricsForPages(project, targets);
  const knownMissed = [...metrics.values()]
    .map((m) => m.missed_pct)
    .filter((v) => v != null);
  const avgMissed = knownMissed.length
    ? Math.round(knownMissed.reduce((a, b) => a + b, 0) / knownMissed.length)
    : null;

  // Normalise sessions for the client component (serialize ObjectIds to strings).
  // The journey is the templates, not the raw paths — "/products/:id" twice is
  // two product pages, and showing two different raw URLs implies more variety
  // than the brand has to reason about.
  const sessionData = projectSessions.map((s) => ({
    sessionId: s.session_id,
    date: s.started_at?.toISOString() ?? null,
    duration: Math.round((s.duration_ms ?? 0) / 1000),
    engagementScore: s.engagement_score,
    pagesVisited: (s.pages_visited ?? []).map((p) => p.template ?? p.path),
    dataAccepted: s.data_accepted,
  }));


  // ── Site-level rollup ────────────────────────────────────────────────────
  // A project used to be a handful of hand-typed pages; with auto-discovery it
  // is a map of whatever the site turned out to be, so these answer "how much of
  // my site is actually covered" before the per-page tables answer "how well".
  const suggestionCount = project.pages.filter(
    (p) => !p.target && p.approval_status === "pending"
  ).length;
  const previewsReady = targets.filter((p) => p.current_capture?.desktop).length;

  const pagesPerSession =
    projectSessions.length > 0
      ? (
          projectSessions.reduce(
            (sum, s) =>
              sum + new Set((s.pages_visited ?? []).map((p) => p.template ?? p.path)).size,
            0
          ) / projectSessions.length
        ).toFixed(1)
      : "0";

  const tally = (key) => {
    const counts = new Map();
    for (const s of projectSessions) {
      const t = s[key];
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  };
  const topEntry = tally("entry_template");
  const topExit = tally("exit_template");

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
        <StatCard label="Avg engagement" value={avgEngagement ?? "—"} icon="💚" />
        <StatCard
          label="Avg missed elements"
          value={avgMissed == null ? "—" : `${avgMissed}%`}
          icon="⚠️"
        />
        <StatCard
          label="Avg session time"
          value={`${minSec}:${secRem.toString().padStart(2, "0")}`}
          icon="⏱️"
        />
      </div>

      {/* Site coverage — what the extension has actually mapped of this site */}
      <div className="mb-8 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Site coverage</h2>
          <p className="text-xs text-zinc-400">
            {suggestionCount > 0
              ? `${suggestionCount} more ${suggestionCount === 1 ? "page" : "pages"} seen on your site`
              : "Only target pages are reported on"}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Target pages</p>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{targets.length}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Previews ready</p>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {previewsReady}
              <span className="ml-1 text-xs font-normal text-zinc-400">of {targets.length}</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Pages per session</p>
            <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{pagesPerSession}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Top entry → exit</p>
            <p className="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300 mt-1 truncate">
              {topEntry ? topEntry[0] : "—"}
            </p>
            <p className="text-xs font-mono font-medium text-zinc-500 dark:text-zinc-400 truncate">
              ↳ {topExit ? topExit[0] : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <ProjectTabs
        projectId={projectId}
        domain={project.domain}
        sessions={sessionData}
      />
    </div>
  );
}
