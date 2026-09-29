"use client";

import { useEffect, useState, useCallback } from "react";

// A single card the brand paste-installs on their site. Keys are minted from
// this tab because it's the one place where the brand is ready to instrument:
// they came here to install, they have their CMS or code editor open, and the
// key is only useful next to the snippet that uses it.

function timeAgo(iso) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Some browsers block clipboard writes without a user gesture on
          // secure origin. Fall back to a selection so the user can Cmd-C.
          const ta = document.createElement("textarea");
          ta.value = value;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); } catch { /* nothing else to try */ }
          ta.remove();
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium transition-colors ${
        copied
          ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-300"
          : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-violet-400 dark:hover:border-violet-600"
      }`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

// Status pill telling the brand whether their tag is actually posting. Reads
// the most recent last_used_at across all live keys — a fresh timestamp
// means the tag is running SOMEWHERE (the origin check on the server
// guarantees that "somewhere" is under the project's domain), so the pill is
// the honest answer to "did I paste the snippet correctly and is it working".
function StatusPill({ keys, tick /* eslint-disable-line no-unused-vars */ }) {
  var mostRecent = null;
  (keys ?? []).forEach(function (k) {
    if (!k.last_used_at) return;
    var t = new Date(k.last_used_at).getTime();
    if (mostRecent == null || t > mostRecent) mostRecent = t;
  });

  const now = Date.now();
  const ageMs = mostRecent == null ? null : now - mostRecent;

  let state; let label; let tone; let dot;
  if (ageMs == null) {
    state = "waiting";
    label = "Waiting for first event";
    tone = "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700";
    dot = "bg-zinc-400";
  } else if (ageMs < 30_000) {
    state = "live";
    label = "Live · event just now";
    tone = "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
    dot = "bg-emerald-500 animate-pulse";
  } else if (ageMs < 60 * 60_000) {
    state = "recent";
    label = "Recent · last event " + formatAge(ageMs) + " ago";
    tone = "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
    dot = "bg-emerald-500";
  } else if (ageMs < 24 * 60 * 60_000) {
    state = "idle";
    label = "Idle · last event " + formatAge(ageMs) + " ago";
    tone = "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800";
    dot = "bg-amber-500";
  } else {
    state = "stale";
    label = "No recent traffic · last " + formatAge(ageMs) + " ago";
    tone = "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700";
    dot = "bg-zinc-400";
  }

  return (
    <span
      title={state === "live" ? "The tag is posting events right now" : label}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function formatAge(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function KeyRow({ k, onRevoke }) {
  const [revealed, setRevealed] = useState(false);
  const shown = revealed ? k.key : `${k.key.slice(0, 6)}${"•".repeat(20)}${k.key.slice(-4)}`;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs text-zinc-800 dark:text-zinc-200 truncate">
            {shown}
          </code>
          <button
            type="button"
            onClick={() => setRevealed((x) => !x)}
            className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {revealed ? "hide" : "reveal"}
          </button>
        </div>
        <p className="text-[11px] text-zinc-400 mt-0.5">
          {k.name ? `${k.name} · ` : ""}
          created {timeAgo(k.created_at)}
          {k.last_used_at ? ` · last used ${timeAgo(k.last_used_at)}` : " · never used"}
        </p>
      </div>
      <CopyButton value={k.key} />
      <button
        type="button"
        onClick={() => onRevoke(k._id)}
        className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:border-red-300 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400"
      >
        Revoke
      </button>
    </div>
  );
}

export default function InstallTab({ projectId, domain }) {
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Re-render every second so the "N seconds ago" label updates in place
  // without waiting for the next poll.
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/api-keys`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error("fetch failed");
      const d = await r.json();
      setKeys(d.keys ?? []);
      setError("");
    } catch {
      // Keep whatever we last had rather than blanking the UI on a hiccup.
      if (keys === null) setError("Could not load your keys.");
    }
  }, [projectId, keys]);

  useEffect(() => {
    let cancelled = false;
    refresh();
    // Poll every 5s so the "Live" indicator flips within a few seconds of
    // the tag's first event landing. Stopping on tab hide keeps this off
    // the network when the brand is on another tab.
    const iv = setInterval(() => {
      if (!cancelled && !document.hidden) refresh();
    }, 5000);
    const clockIv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      clearInterval(clockIv);
    };
    // refresh is stable-enough — its `keys` dependency would restart the
    // interval on every load, but we want the interval running steadily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function mintKey(name) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create key");
      setKeys((prev) => [...(prev ?? []), data]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId) {
    if (!confirm("Revoke this key? The tag on any site using it will stop capturing.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/api-keys/${keyId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to revoke key");
      setKeys((prev) => (prev ?? []).filter((k) => k._id !== keyId));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (keys === null && !error) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <p className="text-sm text-zinc-400">Loading keys…</p>
      </div>
    );
  }

  const primaryKey = keys?.[0]?.key ?? "pk_YOUR_KEY_HERE";
  // The origin the script is served from is the same origin the tag posts
  // events to — deriving it from the browser rather than hard-coding lets
  // this same install page work in dev, staging and prod without conditional
  // hosts.
  const scriptOrigin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "https://lessmissed.com";
  const snippet = `<!-- LessMissed tag -->\n<script src="${scriptOrigin}/tag/v1/lm.js" data-lm-key="${primaryKey}" async></script>`;

  return (
    <div className="space-y-6">
      {/* Live install status */}
      <div className="flex items-center justify-between gap-3">
        <StatusPill keys={keys} tick={tick} />
        <button
          type="button"
          onClick={refresh}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Refresh now
        </button>
      </div>

      {/* Install snippet */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Install the tag
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Paste this into the &lt;head&gt; of every page on{" "}
              <code className="font-mono text-zinc-700 dark:text-zinc-300">{domain}</code>.
            </p>
          </div>
          <CopyButton value={snippet} label="Copy snippet" />
        </div>

        <pre className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 text-xs font-mono text-zinc-800 dark:text-zinc-200 leading-relaxed">
{snippet}
        </pre>

        {(!keys || keys.length === 0) && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            You need a key first — create one below. The snippet above uses a placeholder.
          </p>
        )}

        <ul className="mt-4 space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <li>· The tag captures clicks, scroll, cursor and page transitions out of the box.</li>
          <li>· Gaze tracking activates when the visitor grants camera permission — no calibration UI needed, it self-adjusts on every click.</li>
          <li>· If you need consent-gated activation, set{" "}
            <code className="font-mono text-zinc-700 dark:text-zinc-300">window.LM_REQUIRE_CONSENT = true</code>{" "}
            before the tag loads and call{" "}
            <code className="font-mono text-zinc-700 dark:text-zinc-300">window.LessMissed.start()</code>{" "}
            after the user opts in.
          </li>
        </ul>
      </div>

      {/* Keys */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Publishable keys
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Safe to embed in your site's HTML. The origin check on{" "}
              <code className="font-mono text-zinc-700 dark:text-zinc-300">{domain}</code>{" "}
              stops anyone from using a leaked key elsewhere.
            </p>
          </div>
          <button
            type="button"
            onClick={() => mintKey(null)}
            disabled={busy}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create a key"}
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {keys && keys.length === 0 ? (
          <p className="text-xs text-zinc-400">
            You don't have any keys yet — create one to activate the snippet above.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(keys ?? []).map((k) => (
              <KeyRow key={k._id} k={k} onRevoke={revokeKey} />
            ))}
          </div>
        )}
      </div>

      {/* Extension alternative */}
      <div className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 p-5">
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            Prefer no code changes?
          </span>{" "}
          Ask visitors to install the LessMissed browser extension instead of embedding this
          tag. Both feed the same insight pipeline, so you can mix and match: some traffic
          from the tag, some from consenting extension users.
        </p>
      </div>
    </div>
  );
}
