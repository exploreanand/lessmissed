"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import HealthBadge from "../../../components/dashboard/HealthBadge";

// Target pages: the pages this project actually captures.
//
// The admin-facing vocabulary here is deliberately plain — "preview",
// "preparing", "update". Nothing in this panel mentions browsers, viewports,
// queues, breakpoints or hashes, because none of that is a decision the admin
// should have to make. They name a page; the system produces a picture of it.

const POLL_MS = 3000;

// How long a page can sit in a working state before we stop polling. The worker
// retries with backoff for a few minutes, so this is generous — but unbounded
// polling on a page whose worker is not running would hammer the API forever.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const STATUS = {
  none: { label: "No preview yet", tone: "zinc" },
  queued: { label: "Preparing preview…", tone: "violet", working: true },
  capturing: { label: "Taking preview…", tone: "violet", working: true },
  captured: { label: "Preview ready", tone: "teal" },
  failed: { label: "Couldn't capture", tone: "red" },
};

const TONES = {
  zinc: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400",
  violet: "bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300",
  teal: "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  red: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400",
};

function StatusChip({ status }) {
  const meta = STATUS[status] ?? STATUS.none;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${TONES[meta.tone]}`}
    >
      {meta.working && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      )}
      {meta.label}
    </span>
  );
}

function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "0.32s" — or an em dash when there is nothing to average. */
function formatSeconds(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * One figure in a row's metric strip. A missing value renders as an em dash —
 * never as 0, which is how every page in the old table came to report 0 s
 * fixation and a failing health score.
 *
 * No hover tooltip: the row's stretched link covers it, so a `title` here would
 * never fire. Anything the admin needs to know is said inline instead.
 */
function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{value}</p>
    </div>
  );
}

export default function TargetPages({ projectId, domain }) {
  const [targets, setTargets] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busySlug, setBusySlug] = useState(null);

  // When polling started, so it can stop rather than run forever against a
  // page whose capture worker is not running.
  const pollingSince = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/pages`);
      if (!res.ok) return;
      const data = await res.json();
      setTargets(data.targets ?? []);
      setSuggestions(data.suggestions ?? []);
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Poll only while something is actually in flight.
  const working = targets.some((p) => STATUS[p.screenshot_status]?.working);

  useEffect(() => {
    if (!working) {
      pollingSince.current = null;
      return;
    }
    if (pollingSince.current == null) pollingSince.current = Date.now();

    const timer = setInterval(() => {
      if (Date.now() - pollingSince.current > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        return;
      }
      load();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [working, load]);

  async function addPage(event) {
    event.preventDefault();
    if (!url.trim() || adding) return;

    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not add that page.");
        return;
      }
      setUrl("");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setAdding(false);
    }
  }

  async function recapture(slug) {
    setBusySlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/pages/${slug}/recapture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not start a new capture.");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Target pages</h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          The pages LessMissed captures and reports on. Everything else on {domain} is ignored.
        </p>
      </div>

      {/* Add a page */}
      <form onSubmit={addPage} className="flex flex-wrap gap-2 px-4 py-3">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`https://${domain}/pricing`}
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none"
          aria-label="Page URL to track"
        />
        <button
          type="submit"
          disabled={adding || !url.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? "Adding…" : "Add page"}
        </button>
      </form>

      {error && (
        <div className="mx-4 mb-3 rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Configured targets */}
      {loaded && targets.length === 0 && (
        <p className="px-4 pb-4 text-sm text-zinc-500 dark:text-zinc-400">
          No pages tracked yet. Add the ones that matter — your homepage, pricing, a key
          landing page — and a preview is prepared automatically.
        </p>
      )}

      {targets.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 border-t border-zinc-100 dark:border-zinc-800">
          {targets.map((page) => {
            const m = page.metrics ?? {};
            const working = STATUS[page.screenshot_status]?.working;
            const href = `/dashboard/projects/${projectId}/pages/${page.slug}`;

            return (
              // The whole row is the target, not just the path — "/" alone is
              // one character wide. Done with a stretched link: the <Link> is
              // the row's real link, and its ::after covers the row. Recapture
              // sits above it on z-10. Wrapping the row in an <a> would nest a
              // <button> inside a link, which is invalid and breaks keyboard focus.
              <li
                key={page.id}
                className="group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800/50"
              >
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
                  {page.screenshot_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${page.screenshot_url}?v=${encodeURIComponent(page.screenshot_captured_at ?? "")}`}
                      alt=""
                      className="h-full w-full object-cover object-top"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={href}
                      className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50 after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-violet-500 focus-visible:after:rounded-none"
                      aria-label={`Open ${page.path}`}
                    >
                      {page.path}
                    </Link>
                    {page.is_wildcard && (
                      <span
                        className={`relative z-10 shrink-0 cursor-help rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TONES.violet}`}
                        title={`Stands for many URLs. Previewed from:\n${page.capture_url}`}
                      >
                        pattern
                      </span>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <StatusChip status={page.screenshot_status} />
                    {page.screenshot_captured_at && page.screenshot_status === "captured" && (
                      <span className="text-[11px] text-zinc-400">
                        updated {timeAgo(page.screenshot_captured_at)}
                      </span>
                    )}
                    {page.availability_status !== "ok" && (
                      <span className="text-[11px] text-red-600 dark:text-red-400">
                        {page.availability_error ?? page.availability_status}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1">
                    <Metric label="Sessions" value={page.session_count ?? 0} />
                    <Metric label="Fixations" value={m.fixation_count ?? 0} />
                    <Metric label="Avg fixation" value={formatSeconds(m.avg_fixation_ms)} />
                    <Metric
                      label="Missed"
                      value={
                        m.missed_pct == null
                          ? "—"
                          : `${m.missed_pct}% (${m.missed_count}/${m.inventory_count})`
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-400">Health</p>
                      {m.health == null ? (
                        <p className="text-sm font-semibold text-zinc-400">—</p>
                      ) : (
                        <HealthBadge score={m.health} />
                      )}
                    </div>
                    <Metric
                      label="Last seen"
                      value={timeAgo(page.last_seen_at ?? page.last_session_at) ?? "—"}
                    />
                  </div>

                  {/* Say why a figure is blank, visibly — not in a hover tooltip. */}
                  {page.screenshot_status === "captured" && m.health_pending === "needs_preview" && (
                    <p className="mt-1.5 text-[11px] text-zinc-400">
                      Missed and health appear after the next preview — use Recapture to take one now.
                    </p>
                  )}
                  {m.health_pending === "needs_sessions" && (
                    <p className="mt-1.5 text-[11px] text-zinc-400">
                      Health appears once {m.sessions_for_health} sessions have visited this page —
                      one visit can&apos;t look at every element, so a score now would mostly measure
                      how little data there is.
                    </p>
                  )}
                </div>

                <button
                  onClick={() => recapture(page.slug)}
                  disabled={busySlug === page.slug || working}
                  className="relative z-10 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Take a fresh preview — use this after you change the page"
                >
                  {busySlug === page.slug ? "Starting…" : "Recapture"}
                </button>

                <svg
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500 dark:text-zinc-600"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                </svg>
              </li>
            );
          })}
        </ul>
      )}

      {/* Discovered pages awaiting a decision. They already collect data; they
          are simply never captured until someone accepts them. */}
      {suggestions.length > 0 && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            Seen on your site ({suggestions.length}) — add any you want reports for
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 12).map((page) => (
              <button
                key={page.id}
                onClick={() => setUrl(page.sample_urls?.[0] ?? `https://${domain}${page.path}`)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400"
                title="Put this URL in the box above"
              >
                {page.path}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
