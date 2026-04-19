"use client";

import { useState } from "react";
import Link from "next/link";
import HealthBadge from "../../../components/dashboard/HealthBadge";

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ProjectTabs({ projectId, pages, sessions }) {
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

      {/* Pages tab */}
      {tab === "pages" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                {["Page", "Sessions", "Avg fixation (s)", "Missed %", "Health"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {pages.map((page) => (
                <tr key={page.pageId} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/projects/${projectId}/pages/${page.slug}`}
                      className="font-medium text-zinc-900 dark:text-zinc-50 hover:text-violet-600 dark:hover:text-violet-400"
                    >
                      {page.path}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{page.sessionCount}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{page.avgFixation}s</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{page.missedPct}%</td>
                  <td className="px-4 py-3"><HealthBadge score={page.healthScore} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sessions tab */}
      {tab === "sessions" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                {["Session ID", "Date", "Duration", "Engagement", "Pages"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{h}</th>
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
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 text-xs">{timeAgo(sess.date)}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatDuration(sess.duration)}</td>
                  <td className="px-4 py-3"><HealthBadge score={sess.engagementScore} /></td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{sess.pagesVisited.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User Flow tab */}
      {tab === "flow" && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-8 text-center">Page-to-page flow (top paths)</p>
          <div className="flex items-center justify-center gap-0 flex-wrap">
            {[
              { label: "/", count: 342 },
              { label: "/collections/:id", count: 178, drop: 164 },
              { label: "/products/:id", count: 134, drop: 44 },
              { label: "/cart", count: 87, drop: 47 },
              { label: "/checkout", count: 53, drop: 34 },
            ].map((node, i) => (
              <div key={node.label} className="flex items-center gap-0">
                {i > 0 && (
                  <div className="flex flex-col items-center mx-1">
                    <svg className="h-4 w-4 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                    <span className="text-[9px] text-zinc-400">{node.drop} drop</span>
                  </div>
                )}
                <div className="flex flex-col items-center gap-1.5">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-center min-w-[80px]">
                    <p className="text-xs font-mono font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-[100px]">{node.label}</p>
                    <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{node.count}</p>
                    <p className="text-[9px] text-zinc-400">sessions</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
