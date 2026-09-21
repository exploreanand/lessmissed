import Link from "next/link";
import { connectDB } from "@/lib/mongoose";
import Project from "@/lib/models/Project";
import { getSessionUser } from "@/lib/auth/session";
import HealthBadge from "../../components/dashboard/HealthBadge";
import DeleteProjectButton from "../../components/dashboard/DeleteProjectButton";
import { loadMetricsForPages } from "@/lib/insights/pageMetrics";

/**
 * Project health: the mean of its target pages' health, or null.
 *
 * Project.health_score is a stored field that nothing has ever written, so
 * every project card showed a red 0. Pages whose health is unknown are left out
 * rather than averaged in as 0.
 */
async function projectHealth(project) {
  const targets = (project.pages ?? []).filter((p) => p.target);
  if (!targets.length) return null;
  const metrics = await loadMetricsForPages(project, targets);
  const known = [...metrics.values()].map((m) => m.health).filter((h) => h != null);
  return known.length ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : null;
}

function timeAgo(date) {
  if (!date) return "never";
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  await connectDB();
  const projects = await Project.find({ client_id: user.userId }).sort({ created_at: -1 }).lean();
  const health = await Promise.all(projects.map(projectHealth));

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Your projects</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {projects.length} active project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/dashboard/setup"
          className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New project
        </Link>
      </div>

      {/* Project grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.map((project, index) => {
          const id = project._id.toString();
          const score = health[index];
          const targetCount = project.pages.filter((p) => p.target).length;
          const lastSession = project.pages
            .map((p) => p.last_session_at)
            .filter(Boolean)
            .sort()
            .pop();
          return (
            // The whole card opens the project, not just the small "View" text.
            // Stretched link on the name; Delete sits above it on z-10 so it
            // stays its own control rather than a button nested inside a link.
            <div
              key={id}
              className="group relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col gap-4 hover:border-violet-300 dark:hover:border-violet-700 focus-within:border-violet-400 transition-colors"
            >
              {/* Project identity */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/projects/${id}`}
                    className="font-semibold text-zinc-900 dark:text-zinc-50 after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus:outline-none"
                  >
                    {project.name}
                  </Link>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">{project.domain}</p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Sessions", value: (project.total_sessions ?? 0).toLocaleString() },
                  { label: "Target pages", value: targetCount },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3 text-center">
                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{s.value}</p>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{s.label}</p>
                  </div>
                ))}
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3 text-center">
                  <div className="flex h-7 items-center justify-center">
                    {score == null ? (
                      <span className="text-lg font-bold text-zinc-400">—</span>
                    ) : (
                      <HealthBadge score={score} />
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Health</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-xs text-zinc-400">
                  Last session {timeAgo(lastSession)}
                </p>
                <div className="flex items-center gap-3">
                  <div className="relative z-10">
                    <DeleteProjectButton projectId={id} projectName={project.name} />
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-xs font-semibold text-violet-600 dark:text-violet-400 group-hover:underline"
                  >
                    View →
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* Add project CTA */}
        <Link
          href="/dashboard/setup"
          className="rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 p-6 flex flex-col items-center justify-center gap-3 text-center hover:border-violet-400 dark:hover:border-violet-600 transition-colors group"
        >
          <div className="h-10 w-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center group-hover:bg-violet-100 dark:group-hover:bg-violet-900/50 transition-colors">
            <svg className="h-5 w-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Add a project</p>
        </Link>
      </div>
    </div>
  );
}
