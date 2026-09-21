"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import HealthBadge from "../../../components/dashboard/HealthBadge";
import TargetPages from "./TargetPages";

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDwell(ms) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const TH =
  "text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide";
const TD = "px-4 py-3 text-zinc-600 dark:text-zinc-400";

// ---------------------------------------------------------------------------
// User Flow — the real page-to-page journey
// ---------------------------------------------------------------------------

function FlowTab({ projectId }) {
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/flow`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setFlow(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Could not load the flow.</p>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <p className="text-sm text-zinc-400">Loading flow…</p>
      </div>
    );
  }

  if (!flow.nodes.length) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No journeys recorded yet</p>
        <p className="text-xs text-zinc-400 mt-1 leading-5">
          Flows are built from completed sessions. Start tracking with the extension and browse
          across a few pages — the path is captured automatically.
        </p>
      </div>
    );
  }

  const maxPathSessions = Math.max(...flow.top_paths.map((p) => p.sessions), 1);

  return (
    <div className="space-y-6">
      {/* Most common journeys */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-5">
          Most common journeys · {flow.total_sessions} sessions
        </p>

        <div className="space-y-4">
          {flow.top_paths.map((journey, idx) => (
            <div key={idx}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {journey.sessions} {journey.sessions === 1 ? "session" : "sessions"}
                </span>
                <div className="flex-1 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${(journey.sessions / maxPathSessions) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center flex-wrap gap-1">
                {journey.path.map((template, i) => (
                  <div key={`${template}-${i}`} className="flex items-center gap-1">
                    {i > 0 && (
                      <svg className="h-3 w-3 text-zinc-300 dark:text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    )}
                    <span className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300">
                      {template}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-page entries, exits, drop-off */}
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              {["Page", "Sessions", "Entered here", "Left from here", "Drop-off", "Avg time"].map((h) => (
                <th key={h} className={TH}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {flow.nodes.map((node) => (
              <tr key={node.template} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors">
                <td className="px-4 py-3">
                  {node.slug ? (
                    <Link
                      href={`/dashboard/projects/${projectId}/pages/${node.slug}`}
                      className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-50 hover:text-violet-600 dark:hover:text-violet-400"
                    >
                      {node.template}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-zinc-500">{node.template}</span>
                  )}
                </td>
                <td className={TD}>{node.sessions}</td>
                <td className={TD}>{node.entries}</td>
                <td className={TD}>{node.exits}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-semibold ${
                      node.exit_rate >= 70
                        ? "text-red-600 dark:text-red-400"
                        : node.exit_rate >= 40
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {node.exit_rate}%
                  </span>
                </td>
                <td className={TD}>{formatDwell(node.avg_dwell_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transitions */}
      {flow.edges.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">
            Top transitions
          </p>
          <div className="space-y-2">
            {flow.edges.slice(0, 10).map((edge) => (
              <div key={`${edge.from}->${edge.to}`} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-zinc-600 dark:text-zinc-400 truncate max-w-[38%]">{edge.from}</span>
                <svg className="h-3 w-3 text-zinc-300 dark:text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
                <span className="font-mono text-zinc-600 dark:text-zinc-400 truncate max-w-[38%]">{edge.to}</span>
                <span className="ml-auto font-semibold text-zinc-900 dark:text-zinc-50 shrink-0">
                  {edge.sessions}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ProjectTabs({ projectId, domain, sessions }) {
  const [tab, setTab] = useState("pages");

  const tabs = ["pages", "sessions", "flow"];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800 mb-6">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-violet-600 text-violet-600 dark:text-violet-400 dark:border-violet-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
          >
            {t === "flow" ? "User Flow" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Pages tab — one list. It used to show every page twice: once in the
          Target pages panel and again in a table below it, with capture state
          repeated in both and a table column of metrics nothing ever computed. */}
      {tab === "pages" && <TargetPages projectId={projectId} domain={domain} />}

      {/* Sessions tab */}
      {tab === "sessions" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                {["Session ID", "Date", "Duration", "Engagement", "Pages", "Journey"].map((h) => (
                  <th key={h} className={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sessions.map((sess) => (
                <tr key={sess.sessionId} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/projects/${projectId}/sessions/${sess.sessionId}`}
                      className="font-mono text-xs text-violet-600 dark:text-violet-400 hover:underline"
                    >
                      {sess.sessionId}
                    </Link>
                  </td>
                  <td className={`${TD} text-xs`}>{timeAgo(sess.date)}</td>
                  <td className={TD}>{formatDuration(sess.duration)}</td>
                  <td className="px-4 py-3"><HealthBadge score={sess.engagementScore} /></td>
                  <td className={TD}>{sess.pagesVisited.length}</td>
                  <td className="px-4 py-3">
                    <span
                      className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate block max-w-[280px]"
                      title={sess.pagesVisited.join(" → ")}
                    >
                      {sess.pagesVisited.join(" → ") || "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User Flow tab */}
      {tab === "flow" && <FlowTab projectId={projectId} />}
    </div>
  );
}
