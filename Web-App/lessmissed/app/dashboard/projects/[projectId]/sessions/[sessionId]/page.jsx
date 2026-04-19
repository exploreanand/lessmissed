import Link from "next/link";
import { notFound } from "next/navigation";
import { connectDB } from "@/lib/mongoose";
import Session from "@/lib/models/Session";
import HealthBadge from "../../../../../components/dashboard/HealthBadge";
import ReplayPlayer from "./ReplayPlayer";

function timeAgo(date) {
  if (!date) return "unknown";
  const diff = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(ms) {
  const totalSec = Math.round((ms ?? 0) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default async function SessionReplayPage({ params }) {
  const { projectId, sessionId } = await params;
  await connectDB();

  // sessionId in URL is the session_id string (e.g. sess_abc123)
  const session = await Session.findOne({
    project_id: projectId,
    session_id: sessionId,
  }).lean();

  if (!session) notFound();

  const pagesVisited = (session.pages_visited ?? []).map((p) => p.path);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">Session Replay</h1>
        <p className="text-xs font-mono text-zinc-400 mt-1">{session.session_id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Player */}
        <div className="lg:col-span-2">
          <ReplayPlayer />
        </div>

        {/* Metadata sidebar */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Session details</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Engagement score</span>
                <HealthBadge score={session.engagement_score} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Duration</span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {formatDuration(session.duration_ms)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Recorded</span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {timeAgo(session.started_at)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Pages visited</span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {pagesVisited.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Data accepted</span>
                <span
                  className={`text-xs font-semibold ${
                    session.data_accepted
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {session.data_accepted ? "Yes" : "Quarantined"}
                </span>
              </div>
            </div>

            {/* Engagement breakdown */}
            {session.engagement_breakdown && (
              <div>
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Score breakdown</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Fixation diversity", key: "fixation_diversity", weight: "30%" },
                    { label: "Saccade pattern", key: "saccade_naturalness", weight: "25%" },
                    { label: "Scroll-gaze corr.", key: "scroll_gaze_correlation", weight: "20%" },
                    { label: "Page coverage", key: "page_coverage", weight: "15%" },
                    { label: "Interaction", key: "interaction_signals", weight: "10%" },
                  ].map(({ label, key, weight }) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 w-28 flex-shrink-0">{label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{ width: `${session.engagement_breakdown[key] ?? 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-400 w-6 text-right">
                        {session.engagement_breakdown[key] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">Pages visited</p>
              <ol className="space-y-1.5">
                {pagesVisited.map((url, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="flex-shrink-0 h-4 w-4 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center font-semibold text-[9px]">
                      {i + 1}
                    </span>
                    <span className="font-mono truncate">{url}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Session summary stats */}
          {session.summary && (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">Session summary</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Fixations", value: session.summary.total_fixations ?? 0 },
                  { label: "Clicks", value: session.summary.total_clicks ?? 0 },
                  { label: "Scroll depth", value: `${Math.round(session.summary.max_scroll_depth_percent ?? 0)}%` },
                  { label: "Rage clicks", value: session.summary.rage_clicks ?? 0 },
                  { label: "Dead clicks", value: session.summary.dead_clicks ?? 0 },
                  { label: "Scroll-backs", value: session.summary.scroll_backs ?? 0 },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-zinc-50 dark:bg-zinc-800 p-2.5 text-center">
                    <p className="text-base font-bold text-zinc-900 dark:text-zinc-50">{stat.value}</p>
                    <p className="text-[9px] text-zinc-400 uppercase tracking-wide mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Privacy note */}
          <div className="rounded-2xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/30 p-4">
            <div className="flex items-start gap-2">
              <svg className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-teal-800 dark:text-teal-300">Session is anonymized</p>
                <p className="text-xs text-teal-700 dark:text-teal-400 mt-0.5 leading-4">No personal data, name, or identity is linked to this session. Only gaze coordinates and page URLs are stored.</p>
              </div>
            </div>
          </div>

          <Link
            href={`/dashboard/projects/${projectId}`}
            className="block text-center rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-violet-400 dark:hover:border-violet-600 transition-colors"
          >
            ← Back to project
          </Link>
        </div>
      </div>
    </div>
  );
}
