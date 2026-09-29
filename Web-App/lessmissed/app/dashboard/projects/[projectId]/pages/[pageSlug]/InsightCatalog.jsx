"use client";

import { useState } from "react";
import Link from "next/link";

/* ─── catalog data ────────────────────────────────────────────────────────── */

const CATEGORIES = [
  { id: "gaze",       label: "Gaze",        count: 8 },
  { id: "scroll",     label: "Scroll",       count: 4 },
  { id: "click",      label: "Click",        count: 4 },
  { id: "gaze_click", label: "Gaze + Click", count: 6 },
  { id: "session",    label: "Session",      count: 4 },
];

const S = {
  gaze:       { border: "border-violet-500", text: "text-violet-600 dark:text-violet-400", id: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", bar: "bg-violet-500" },
  scroll:     { border: "border-sky-500",     text: "text-sky-600 dark:text-sky-400",         id: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",             bar: "bg-sky-500"     },
  click:      { border: "border-emerald-500", text: "text-emerald-600 dark:text-emerald-400", id: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300", bar: "bg-emerald-500" },
  gaze_click: { border: "border-amber-500",   text: "text-amber-600 dark:text-amber-400",     id: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",    bar: "bg-amber-500"   },
  session:    { border: "border-rose-500",     text: "text-rose-600 dark:text-rose-400",       id: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",         bar: "bg-rose-500"    },
};

const ALL_INSIGHTS = {
  gaze: [
    { id: "INS-G01", name: "Gaze Heatmap",                 phase: 1, desc: "Aggregated fixation coordinates weighted by dwell time. Thermal overlay showing where users look most." },
    { id: "INS-G02", name: "Element Attention Ranking",     phase: 1, desc: "Fixation count and dwell per element. Ranked list of what gets seen — unique vs click-only tools." },
    { id: "INS-G03", name: "Missed Elements",               phase: 1, desc: "Elements with zero fixations across sessions. What your users never see." },
    { id: "INS-G04", name: "First Fixation Point",          phase: 1, desc: "First 200ms+ fixation after page load per session. Most common region users look at first." },
    { id: "INS-G05", name: "Fixation Duration per Element", phase: 1, desc: "Average and median dwell time per element. Long fixation = interest OR confusion (context-dependent)." },
    { id: "INS-G06", name: "Scan Path / Reading Order",     phase: 1, desc: "Most common fixation subsequences across sessions. Reveals actual vs intended reading flow." },
    { id: "INS-G07", name: "Backtracking / Re-reading",     phase: 1, desc: "User returns to a previously fixated element. Signals confusion or comparison behavior." },
    { id: "INS-G08", name: "Attention Drop-off Point",      phase: 1, desc: "Page decile where fixation rate drops below 50%. Different from scroll depth — users may scroll past without looking." },
  ],
  scroll: [
    { id: "INS-S01", name: "Scroll Depth",        phase: 1, desc: "Max scroll depth per session, averaged. Horizontal markers at 25/50/75/100% reach." },
    { id: "INS-S02", name: "Scroll Velocity Map",  phase: 1, desc: "Average scroll velocity per page decile. Fast = skimmed, slow = read carefully." },
    { id: "INS-S03", name: "Scroll-Back Events",   phase: 1, desc: "Count per page section. Identifies content that pulls users back up the page." },
    { id: "INS-S04", name: "Fold Awareness",        phase: 1, desc: "Scroll depth + element fixation combined. Net visibility per element below the fold." },
  ],
  click: [
    { id: "INS-C01", name: "Click Heatmap",          phase: 1, desc: "Aggregated click coordinates. Separate overlay from gaze heatmap — toggle in the viewer above." },
    { id: "INS-C02", name: "Rage Clicks",             phase: 1, desc: "3+ clicks on same element within 1500ms. Frustration signal on broken interactions." },
    { id: "INS-C03", name: "Dead Clicks",             phase: 1, desc: "Clicks on non-interactive elements. Reveals misleading affordances in your UI." },
    { id: "INS-C04", name: "Last Click Before Exit",  phase: 1, desc: "Final click in sessions ending without task completion. Identifies conversion killers." },
  ],
  gaze_click: [
    { id: "INS-GC01", name: "Looked But Didn't Click",   phase: 1, primary: true, desc: "Elements with fixation > 0 but click == 0. Problem is persuasion, not visibility." },
    { id: "INS-GC02", name: "Clicked Without Looking",    phase: 1, desc: "Click without preceding 200ms fixation. Muscle memory click — label copy doesn't matter for this element." },
    { id: "INS-GC03", name: "Hesitation Time",            phase: 2, desc: "Time between first fixation and click on same element. Short = confident. Long = friction." },
    { id: "INS-GC04", name: "Attention-to-Action Ratio",  phase: 2, desc: "(sessions with fixation) / (sessions with click) per element. > 10:1 = high friction. < 2:1 = converting well." },
    { id: "INS-GC05", name: "Distraction Mapping",        phase: 2, desc: "Gaze pulled from target to different element, never returns to click target. Attention cannibalization." },
    { id: "INS-GC06", name: "Comparison Behavior",        phase: 2, desc: "Gaze alternating A-B-A-B 2+ times in 10s before clicking one option. Reveals what users compare." },
  ],
  session: [
    { id: "INS-SL03", name: "Session Replay + Gaze Dot", phase: 1, desc: "rrweb recording with overlaid gaze dot and click indicators. Synchronized playback." },
    { id: "INS-SL04", name: "Engagement Score",           phase: 1, desc: "Per-session quality gate score in replay list. Aggregate score per page." },
    { id: "INS-SL01", name: "Confusion Score",            phase: 2, desc: "Composite: backtracking (30%) + scroll-backs (25%) + hesitation time (25%) + re-fixation ratio (20%)." },
    { id: "INS-SL02", name: "Task Completion Path",       phase: 2, desc: "Ordered page URLs per session. Most common path vs intended. Deviation detection." },
  ],
};

// Derived from the catalog itself so the header cannot drift out of step with it.
const TOTAL_INSIGHTS = Object.values(ALL_INSIGHTS).reduce((n, list) => n + list.length, 0);

/* ─── shared micro-components ─────────────────────────────────────────────── */

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-full px-2 py-0.5 flex-shrink-0">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
      Live
    </span>
  );
}

function Phase2Badge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-full px-2 py-0.5 flex-shrink-0">
      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25-2.25z" />
      </svg>
      Phase 2
    </span>
  );
}

function IdBadge({ id, catId }) {
  return (
    <span className={`inline-block text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${S[catId].id}`}>
      {id}
    </span>
  );
}

/* ─── locked card (phase 2) ──────────────────────────────────────────────── */

function LockedCard({ ins, catId }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/30 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <IdBadge id={ins.id} catId={catId} />
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{ins.name}</h3>
        </div>
        <Phase2Badge />
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">{ins.desc}</p>
    </div>
  );
}

/* ─── live card shell ────────────────────────────────────────────────────── */

function LiveCard({ ins, catId, wide, children }) {
  return (
    <div className={`rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-4 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <IdBadge id={ins.id} catId={catId} />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{ins.name}</h3>
        </div>
        <LiveBadge />
      </div>
      {children}
    </div>
  );
}

/* ─── phase 1 card contents ──────────────────────────────────────────────── */

function GazeHeatmapCard({ ins, catId, insights, elements }) {
  const seen = elements.filter((e) => e.pct >= 10).length;
  const coverage = elements.length > 0 ? Math.round((seen / elements.length) * 100) : 0;
  const avgDwellSec = insights.avg_dwell_ms > 0 ? (insights.avg_dwell_ms / 1000).toFixed(1) : "—";
  const topElement = elements[0]?.label ?? elements[0]?.element_id ?? "—";

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{coverage}%</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">elements fixated</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{avgDwellSec}s</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">avg dwell</p>
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Top zone: <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate">{topElement}</span>
      </p>
      <p className={`text-xs font-medium ${S[catId].text}`}>↑ Switch to Gaze mode in the viewer above</p>
    </LiveCard>
  );
}

function ElementAttentionCard({ ins, catId, elements }) {
  const top5 = elements.slice(0, 5);
  const maxCount = top5[0]?.fixation_count ?? 1;

  if (top5.length === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">No fixation data for this page yet.</p>
      </LiveCard>
    );
  }

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="space-y-2.5">
        {top5.map((el) => (
          <div key={el.key ?? el.element_id}>
            <div className="flex justify-between mb-1">
              <span title={el.element_id} className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]">{el.label ?? el.element_id}</span>
              <span className="text-xs font-semibold text-zinc-500 ml-2 flex-shrink-0">{el.fixation_count}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${S[catId].bar}`}
                style={{ width: `${Math.round((el.fixation_count / maxCount) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">Fixation count across all sessions</p>
    </LiveCard>
  );
}

function MissedElementsCard({ ins, catId, elements }) {
  const missed = elements.filter((el) => el.pct < 10);

  return (
    <LiveCard ins={ins} catId={catId}>
      <div>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{missed.length}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">elements rarely seen</p>
      </div>
      {missed.length > 0 ? (
        <div className="space-y-2">
          {missed.slice(0, 4).map((el) => (
            <div key={el.key ?? el.element_id} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" />
              <span title={el.element_id} className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{el.label ?? el.element_id}</span>
              <span className="ml-auto text-xs text-zinc-400 flex-shrink-0">{el.pct}%</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">All tracked elements have at least some attention</p>
      )}
      <p className="text-xs text-zinc-400 dark:text-zinc-500">Threshold: &lt;10% of sessions with fixation</p>
    </LiveCard>
  );
}

function FirstFixationCard({ ins, catId, insights }) {
  const ff = insights.first_fixation;

  if (!ff || ff.sessions_with_first_fixation === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">No first-fixation data for this page yet.</p>
      </LiveCard>
    );
  }

  const topRegion = ff.top_region;
  const maxCell = Math.max(...ff.regions.map((r) => r.session_count), 1);
  const top3 = ff.top_elements.slice(0, 3);
  const maxElement = top3[0]?.session_count ?? 1;
  const medianSec =
    ff.median_time_to_first_ms > 0 ? (ff.median_time_to_first_ms / 1000).toFixed(1) : "—";

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {topRegion?.pct ?? 0}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            look at {topRegion?.label.toLowerCase() ?? "—"} first
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{medianSec}s</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">median time to first look</p>
        </div>
      </div>

      {/* 3×3 first-look region map — one cell per screen third */}
      <div className="grid grid-cols-3 gap-0.5 w-24">
        {ff.regions.map((cell) => (
          <div
            key={cell.index}
            title={`${cell.label} · ${cell.pct}%`}
            className={`aspect-square rounded-sm ${S[catId].bar}`}
            style={{ opacity: 0.15 + 0.85 * (cell.session_count / maxCell) }}
          />
        ))}
      </div>

      <div className="space-y-2.5">
        {top3.map((el) => (
          <div key={el.key ?? el.element_id}>
            <div className="flex justify-between mb-1">
              <span title={el.element_id} className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]">{el.label ?? el.element_id}</span>
              <span className="text-xs font-semibold text-zinc-500 ml-2 flex-shrink-0">{el.pct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${S[catId].bar}`}
                style={{ width: `${Math.round((el.session_count / maxElement) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        First 200ms+ fixation in {ff.sessions_with_first_fixation} of {ff.total_sessions} sessions
        {ff.below_fold_pct != null && ` · ${100 - ff.below_fold_pct}% above the fold`}
      </p>

      {ff.region_basis === "observed" && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Regions estimated from gaze bounds — capture a page screenshot for exact regions
        </p>
      )}

      <p className={`text-xs font-medium ${S[catId].text}`}>↑ Switch to First look mode in the viewer above</p>
    </LiveCard>
  );
}

function FixationDurationCard({ ins, catId, elements }) {
  // INS-G05: avg + median dwell time per element. A dwell of 200ms+ is a real
  // fixation (the same threshold INS-G04 uses); anything below is noise from
  // saccade tails, so those rows are hidden from the ranking.
  const scored = elements
    .filter((e) => e.fixation_count > 0 && (e.median_dwell_ms ?? 0) >= 200)
    .sort((a, b) => (b.median_dwell_ms ?? 0) - (a.median_dwell_ms ?? 0));

  if (scored.length === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">Not enough fixation data on this page yet.</p>
      </LiveCard>
    );
  }

  const top = scored.slice(0, 5);
  const maxMs = top[0].median_dwell_ms;
  const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  const pageAvg = Math.round(
    scored.reduce((a, e) => a + e.avg_dwell_ms, 0) / scored.length
  );
  const pageMedian = medianOfNumbers(scored.map((e) => e.median_dwell_ms));

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{fmt(pageMedian)}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">median dwell / element</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{fmt(pageAvg)}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">avg dwell / element</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {top.map((el) => (
          <div key={el.key ?? el.element_id}>
            <div className="flex justify-between mb-1 gap-2">
              <span
                title={el.element_id}
                className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]"
              >
                {el.label ?? el.element_id}
              </span>
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                {fmt(el.median_dwell_ms)}
                <span className="text-zinc-400 font-normal"> · avg {fmt(el.avg_dwell_ms)}</span>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${S[catId].bar}`}
                style={{ width: `${Math.round((el.median_dwell_ms / maxMs) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Ranked by median dwell · long fixation = interest or confusion (check the replay)
      </p>
    </LiveCard>
  );
}

// Local helper — the page.jsx server component has its own copy, but the
// catalog is a client bundle and needs its own to avoid pulling in server code.
function medianOfNumbers(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function ScanPathCard({ ins, catId, insights }) {
  // INS-G06: ordered scan path across sessions. The bigrams answer "after
  // element A, where did users look next?" — the primary reading-order signal.
  // The modal opening gives the most common first 3 steps as a scan pattern.
  const sp = insights.scan_path;

  if (!sp || sp.sessions_with_path === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">
          Not enough multi-element fixation data on this page yet.
        </p>
      </LiveCard>
    );
  }

  const bigrams = sp.top_bigrams ?? [];
  const opening = sp.modal_opening;
  const maxBigramPct = bigrams[0]?.pct ?? 1;

  return (
    <LiveCard ins={ins} catId={catId} wide>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {sp.median_path_length}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">median elements per scan</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {sp.sessions_with_path}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of {sp.total_sessions} sessions scanned
          </p>
        </div>
      </div>

      {opening && (
        <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 px-3 py-2.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">
            Modal opening · {opening.pct}% of sessions
          </p>
          <ScanPathArrow catId={catId} path={opening.path} />
        </div>
      )}

      {bigrams.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Top transitions (element → next element)
          </p>
          {bigrams.map((row) => (
            <div key={row.path.join("→")}>
              <div className="flex justify-between mb-1 gap-2">
                <div className="flex-1 min-w-0">
                  <ScanPathArrow catId={catId} path={row.path} />
                </div>
                <span className="text-xs font-semibold text-zinc-500 ml-2 flex-shrink-0 tabular-nums">
                  {row.pct}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${S[catId].bar}`}
                  style={{ width: `${Math.round((row.pct / maxBigramPct) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Consecutive fixations on the same element collapse into one step · rare paths (1 session) hidden
      </p>
    </LiveCard>
  );
}

function ScanPathArrow({ catId, path }) {
  return (
    <div className="flex items-center flex-wrap gap-x-1 gap-y-1 text-xs text-zinc-700 dark:text-zinc-200 leading-snug">
      {path.map((label, i) => (
        <span key={`${i}-${label}`} className="inline-flex items-center gap-1 min-w-0">
          {i > 0 && (
            <span className={`text-[10px] flex-shrink-0 ${S[catId].text}`} aria-hidden>
              →
            </span>
          )}
          <span
            title={label}
            className="truncate max-w-[140px] font-medium"
          >
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}

function BacktrackingCard({ ins, catId, insights }) {
  // INS-G07: revisits per element. A "revisit" is a return to an element after
  // fixating on a different one — dwell doesn't count. High rates on a single
  // element read as confusion or comparison; broadly-shared revisits suggest a
  // page-level scan pattern that needs a look.
  const bt = insights.backtracking;

  if (!bt || bt.eligible_sessions === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">
          Not enough multi-fixation sessions on this page yet.
        </p>
      </LiveCard>
    );
  }

  const top = bt.top_revisited ?? [];
  const maxPct = top[0]?.pct_sessions ?? 1;

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {bt.pct_sessions_with_backtracking}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of sessions backtracked
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {bt.median_revisits_per_session}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            median revisits per backtracker
          </p>
        </div>
      </div>

      {top.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Most revisited elements
          </p>
          {top.map((el) => (
            <div key={el.key ?? el.element_id}>
              <div className="flex justify-between mb-1 gap-2">
                <span
                  title={el.element_id}
                  className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]"
                >
                  {el.label ?? el.element_id}
                </span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                  {el.pct_sessions}%
                  {el.avg_revisits_when_revisited > 1 && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · ×{el.avg_revisits_when_revisited}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${S[catId].bar}`}
                  style={{ width: `${Math.round((el.pct_sessions / maxPct) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          No element caused repeat visits across ≥2 sessions yet.
        </p>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Dwell on the same element collapses to one visit · sessions with fewer than 3 fixations excluded
      </p>
    </LiveCard>
  );
}

function AttentionDropOffCard({ ins, catId, insights }) {
  // INS-G08: per-decile fixation reach vs scroll reach. The differentiator vs
  // INS-S01 is precisely the gap between the two — users scroll past regions
  // they never look at, and this card names the deepest such region.
  const ado = insights.attention_drop_off;

  if (!ado || ado.total_fixations === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">
          Not enough fixation data on this page yet.
        </p>
      </LiveCard>
    );
  }

  const dropOff = ado.drop_off_decile;
  const gap = ado.worst_gap;

  return (
    <LiveCard ins={ins} catId={catId} wide>
      <div className="flex flex-wrap gap-6">
        <div>
          {dropOff ? (
            <>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {dropOff.label}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                attention drops below 50% here
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                None
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                attention holds above 50% down the page
              </p>
            </>
          )}
        </div>
        {gap && (
          <div className="border-l border-zinc-200 dark:border-zinc-700 pl-6">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {gap.gap_pct}pp
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              scroll-vs-look gap at{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{gap.label}</span>
            </p>
          </div>
        )}
      </div>

      {gap && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          At <span className="font-semibold">{gap.label}</span>,{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{gap.pct_reached}%</span>{" "}
          of users scrolled there but only{" "}
          <span className={`font-semibold ${S[catId].text}`}>{gap.pct_fixated}%</span> actually looked.
        </p>
      )}

      {/* Per-decile chart — reached bar (light) behind, fixated bar (solid) in front,
          so the amber region between them is the attention loss. */}
      <div className="space-y-1.5">
        {ado.deciles.map((d) => {
          const isDropOff = dropOff && d.index === dropOff.index;
          return (
            <div key={d.index} className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-400 w-14 flex-shrink-0 tabular-nums">
                {d.label}
              </span>
              <div className="flex-1 relative h-3 flex items-center">
                <div
                  className={`absolute h-2 rounded-full ${S[catId].bar} opacity-15`}
                  style={{ width: `${d.pct_reached}%` }}
                />
                <div
                  className={`absolute h-2 rounded-full ${S[catId].bar}`}
                  style={{ width: `${d.pct_fixated}%` }}
                />
                {isDropOff && (
                  <span className="absolute -right-1 top-1/2 -translate-y-1/2 h-3 w-[2px] rounded-full bg-amber-500" />
                )}
              </div>
              <span className="text-xs text-zinc-500 w-24 text-right flex-shrink-0 tabular-nums">
                {d.pct_fixated}% / {d.pct_reached}%
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-5 rounded-full ${S[catId].bar} opacity-15`} />
          Scrolled
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-5 rounded-full ${S[catId].bar}`} />
          Fixated
        </span>
        {dropOff && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-[2px] rounded-full bg-amber-500" />
            Drop-off
          </span>
        )}
        {ado.document_height_basis === "observed" && (
          <span className="ml-auto text-zinc-400">
            Deciles estimated from gaze bounds — capture a page screenshot for exact bands
          </span>
        )}
      </div>
    </LiveCard>
  );
}

function FoldAwarenessCard({ ins, catId, insights }) {
  // INS-S04: below-fold elements ranked by net visibility (% scrolled × %
  // fixated when scrolled). The card leads with the worst offender because
  // that's the single question a brand comes here with: "what's below the
  // fold that nobody sees?"
  const fa = insights.fold_awareness;

  if (!fa || fa.total_sessions === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">No session data on this page yet.</p>
      </LiveCard>
    );
  }

  const worst = fa.worst_net_visibility ?? [];
  const gap = fa.biggest_gap ?? [];
  const foldLabel = fa.fold_depth_pct != null ? `${fa.fold_depth_pct}%` : "unknown";

  if (worst.length === 0 && gap.length === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <div className="flex gap-6">
          <div>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{foldLabel}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">fold depth</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {fa.below_fold_count}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">elements below fold</p>
          </div>
        </div>
        <p className="text-xs text-zinc-400">
          Not enough scroll or fixation data to rank below-fold visibility yet.
        </p>
      </LiveCard>
    );
  }

  const top = worst[0];

  return (
    <LiveCard ins={ins} catId={catId} wide>
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{foldLabel}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">fold depth</p>
        </div>
        <div className="border-l border-zinc-200 dark:border-zinc-700 pl-6">
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {fa.below_fold_count}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">elements below fold</p>
        </div>
        {top && (
          <div className="border-l border-zinc-200 dark:border-zinc-700 pl-6">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {top.pct_net_visibility}%
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              worst net visibility ·{" "}
              <span
                title={top.element_id}
                className="font-medium text-zinc-700 dark:text-zinc-300"
              >
                {top.label}
              </span>
            </p>
          </div>
        )}
      </div>

      {worst.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Worst net visibility below the fold
          </p>
          {worst.map((el) => (
            <div key={el.key ?? el.element_id}>
              <div className="flex justify-between mb-1 gap-2">
                <span
                  title={el.element_id}
                  className="text-xs text-zinc-700 dark:text-zinc-200 truncate flex-1"
                >
                  <span className="font-medium">{el.label ?? el.element_id}</span>
                  <span className="text-zinc-400 font-normal"> · at {el.top_pct}% depth</span>
                </span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                  {el.pct_net_visibility}% net
                </span>
              </div>
              <div className="flex-1 relative h-3 flex items-center">
                <div
                  className={`absolute h-2 rounded-full ${S[catId].bar} opacity-20`}
                  style={{ width: `${el.pct_scrolled}%` }}
                />
                <div
                  className={`absolute h-2 rounded-full ${S[catId].bar}`}
                  style={{ width: `${el.pct_net_visibility}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                {el.pct_scrolled}% scrolled here · {el.pct_fixate_when_scrolled}% of them fixated
              </p>
            </div>
          ))}
        </div>
      )}

      {gap.length > 0 && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Biggest scroll-vs-look gap
          </p>
          {gap.slice(0, 3).map((el) => (
            <div key={el.key ?? el.element_id} className="flex items-center gap-3 text-xs">
              <span
                title={el.element_id}
                className="truncate text-zinc-600 dark:text-zinc-400 flex-1"
              >
                {el.label ?? el.element_id}
                <span className="text-zinc-400"> · at {el.top_pct}% depth</span>
              </span>
              <span className="text-zinc-500 dark:text-zinc-400 tabular-nums flex-shrink-0">
                {el.pct_scrolled}% scrolled → {el.pct_net_visibility}% saw ·
                <span className="text-amber-600 dark:text-amber-400 font-semibold ml-1">
                  −{el.gap_pct}pp
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-5 rounded-full ${S[catId].bar} opacity-20`} />
          Scrolled to
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-5 rounded-full ${S[catId].bar}`} />
          Net visibility
        </span>
        {fa.document_height_basis === "observed" && (
          <span className="ml-auto text-zinc-400">
            Positions estimated from gaze bounds — capture a page screenshot for exact positions
          </span>
        )}
      </div>
    </LiveCard>
  );
}

function ScrollBackCard({ ins, catId, insights }) {
  // INS-S03: which page section pulls users back up. Each upward scroll run of
  // ≥5% document height counts as one event, attributed to the destination
  // decile — the region the user came back to re-check.
  const sb = insights.scroll_back;

  if (!sb || sb.total_events === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">0</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">scroll-backs on this page</p>
        </div>
        <p className="text-xs text-zinc-400">
          No user scrolled back ≥5% after moving down.
        </p>
      </LiveCard>
    );
  }

  const deciles = sb.deciles ?? [];
  const maxPct = Math.max(...deciles.map((d) => d.pct_sessions), 1);

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {sb.pct_sessions_with_scroll_back}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of sessions scrolled back
          </p>
        </div>
        {sb.top_decile && sb.top_decile.event_count > 0 && (
          <div>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {sb.top_decile.label}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              pulls users back most
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
          Scroll-back destination · % of sessions
        </p>
        {deciles.map((d) => {
          const hasData = d.session_count > 0;
          return (
            <div key={d.index} className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-400 w-14 flex-shrink-0 tabular-nums">
                {d.label}
              </span>
              <div className="flex-1 h-2 flex items-center">
                <div
                  className={`h-2 rounded-full ${S[catId].bar} ${
                    hasData ? "" : "opacity-20"
                  }`}
                  style={{
                    width: hasData
                      ? `${Math.max(3, Math.round((d.pct_sessions / maxPct) * 100))}%`
                      : "3%",
                  }}
                />
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 w-20 text-right flex-shrink-0 tabular-nums">
                {hasData ? `${d.pct_sessions}% · ${d.event_count}` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Upward motion of ≥5% document height, attributed to the destination decile
      </p>
    </LiveCard>
  );
}

function ScrollVelocityCard({ ins, catId, insights }) {
  // INS-S02: per-decile time-weighted scroll velocity. Categorises each band
  // as skimmed / browsed / read and highlights the two extremes — where the
  // user flew past, and where they slowed down enough to actually read.
  const sv = insights.scroll_velocity;

  if (!sv || sv.total_samples === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">Not enough scroll motion on this page yet.</p>
      </LiveCard>
    );
  }

  const deciles = sv.deciles ?? [];
  const maxVelocity = Math.max(
    ...deciles.map((d) => d.velocity_pct_per_s),
    1
  );

  const catColor = (category) => {
    if (category === "skimmed") return "bg-amber-500";
    if (category === "read") return "bg-emerald-500";
    if (category === "browsed") return S[catId].bar;
    return "bg-zinc-200 dark:bg-zinc-800";
  };
  const catText = (category) => {
    if (category === "skimmed") return "text-amber-600 dark:text-amber-400";
    if (category === "read") return "text-emerald-600 dark:text-emerald-400";
    if (category === "browsed") return S[catId].text;
    return "text-zinc-400";
  };
  const fmt = (v) => `${v.toFixed(1)}%/s`;

  return (
    <LiveCard ins={ins} catId={catId} wide>
      <div className="flex flex-wrap gap-6">
        {sv.fastest_decile && (
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Skimmed fastest</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {sv.fastest_decile.label}
            </p>
            <p className={`text-xs font-medium ${catText(sv.fastest_decile.category)}`}>
              {fmt(sv.fastest_decile.velocity_pct_per_s)}
            </p>
          </div>
        )}
        {sv.slowest_decile && (
          <div className="border-l border-zinc-200 dark:border-zinc-700 pl-6">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-0.5">Read most carefully</p>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {sv.slowest_decile.label}
            </p>
            <p className={`text-xs font-medium ${catText(sv.slowest_decile.category)}`}>
              {fmt(sv.slowest_decile.velocity_pct_per_s)}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {deciles.map((d) => {
          const hasData = d.sample_count > 0;
          return (
            <div key={d.index} className="flex items-center gap-2">
              <span className="text-xs font-mono text-zinc-400 w-14 flex-shrink-0 tabular-nums">
                {d.label}
              </span>
              <div className="flex-1 relative h-2 flex items-center">
                <div
                  className={`h-2 rounded-full ${catColor(d.category)} ${
                    hasData ? "" : "opacity-20"
                  }`}
                  style={{
                    width: hasData
                      ? `${Math.max(3, Math.round((d.velocity_pct_per_s / maxVelocity) * 100))}%`
                      : "3%",
                  }}
                />
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 w-16 text-right flex-shrink-0 tabular-nums">
                {hasData ? fmt(d.velocity_pct_per_s) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-5 rounded-full bg-amber-500" />
          Skimmed
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-5 rounded-full ${S[catId].bar}`} />
          Browsed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-5 rounded-full bg-emerald-500" />
          Read
        </span>
        <span className="ml-auto text-zinc-400">
          Attributed to start decile · time-weighted per session
        </span>
      </div>
    </LiveCard>
  );
}

function ScrollDepthCard({ ins, catId, insights }) {
  // INS-S01: how far down each session got. Median leads because a page with
  // bouncers pulling the mean below its typical value would misread as "worse
  // than it is"; the avg is kept alongside for context on skew. Below both
  // headline tiles: the quartile reach ladder (what fraction of sessions
  // crossed each landmark) and the decile histogram (where each session
  // actually stopped, which the ladder can't show).
  const sd = insights.scroll_depth;

  if (!sd || sd.total_sessions === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">No scroll data on this page yet.</p>
      </LiveCard>
    );
  }

  const reach = sd.reach ?? {};
  const quartiles = [25, 50, 75, 100].map((mark) => ({
    label: `${mark}%`,
    reach: reach[mark] ?? 0,
  }));
  const bands = sd.reach_bands ?? [];
  const maxBandPct = Math.max(...bands.map((b) => b.pct), 1);

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {sd.median_scroll_depth_pct}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">median scroll depth</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {sd.avg_scroll_depth_pct}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">avg scroll depth</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
          Reach at each landmark
        </p>
        {quartiles.map((q) => (
          <div key={q.label} className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-500 w-9 flex-shrink-0">{q.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${S[catId].bar}`}
                style={{ width: `${q.reach}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 w-9 text-right flex-shrink-0 tabular-nums">
              {q.reach}%
            </span>
          </div>
        ))}
      </div>

      {bands.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Where sessions stopped
          </p>
          <div className="flex items-end gap-0.5 h-14">
            {bands.map((b) => (
              <div
                key={b.index}
                title={`${b.label} · ${b.pct}% of sessions (${b.session_count})`}
                className={`flex-1 rounded-t-sm ${S[catId].bar}`}
                style={{
                  height: `${Math.max(4, Math.round((b.pct / maxBandPct) * 100))}%`,
                  opacity: 0.35 + 0.65 * (b.pct / maxBandPct),
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-zinc-400">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
      )}

      <p className={`text-xs font-medium ${S[catId].text}`}>
        ↑ Switch to Scroll mode in the viewer above
      </p>
    </LiveCard>
  );
}

function LastClickBeforeExitCard({ ins, catId, insights }) {
  // INS-C04: which element got the final click on this page for sessions that
  // exited here without completing the task. Ranked by session breadth — the
  // more sessions ended right after touching an element, the more likely that
  // element is a conversion killer.
  const lc = insights.last_click_before_exit;

  if (!lc || lc.exiting_sessions === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">
          No sessions exited this page without completing the task.
        </p>
      </LiveCard>
    );
  }

  const top = lc.top_elements ?? [];
  const maxPct = top[0]?.pct_of_exiting ?? 1;

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {lc.exiting_sessions}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            sessions exited here without completing
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {lc.exiting_sessions_with_click}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of them clicked before leaving
          </p>
        </div>
      </div>

      {top.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Final click destinations
          </p>
          {top.map((el) => (
            <div key={el.key ?? el.element_id}>
              <div className="flex justify-between mb-1 gap-2">
                <span
                  title={el.element_id}
                  className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[180px]"
                >
                  {el.label ?? el.element_id}
                  {el.element_tag && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · &lt;{el.element_tag}&gt;
                    </span>
                  )}
                  {el.is_interactive === false && (
                    <span className="ml-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase">
                      dead
                    </span>
                  )}
                </span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                  {el.pct_of_exiting}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${S[catId].bar}`}
                  style={{ width: `${Math.round((el.pct_of_exiting / maxPct) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          Exiting sessions clicked, but no single element hit the ≥2-session ranking threshold.
        </p>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Percentages are of the {lc.exiting_sessions_with_click} exiting sessions that clicked · dead-flagged rows are last clicks on non-interactive elements
      </p>
    </LiveCard>
  );
}

function DeadClicksCard({ ins, catId, insights }) {
  // INS-C03: clicks that landed on non-interactive DOM. The extension already
  // flags is_interactive on every click event based on tag, so a dead click is
  // just filtered from the raw stream — the card's job is to name which
  // element misled which fraction of users.
  const dc = insights.dead_clicks;

  if (!dc || dc.total_dead_clicks === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">0</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">dead clicks on this page</p>
        </div>
        <p className="text-xs text-zinc-400">
          No clicks landed on non-interactive elements.
        </p>
      </LiveCard>
    );
  }

  const top = dc.top_elements ?? [];
  const maxPct = top[0]?.pct_sessions ?? 1;

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {dc.pct_sessions_with_dead_click}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of sessions dead-clicked
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {dc.total_dead_clicks}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            dead clicks on this page
          </p>
        </div>
      </div>

      {top.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Misleading affordances
          </p>
          {top.map((el) => (
            <div key={el.key ?? el.element_id}>
              <div className="flex justify-between mb-1 gap-2">
                <span
                  title={el.element_id}
                  className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]"
                >
                  {el.label ?? el.element_id}
                  {el.element_tag && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · &lt;{el.element_tag}&gt;
                    </span>
                  )}
                </span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                  {el.pct_sessions}%
                  {el.avg_clicks_per_session > 1 && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · ×{el.avg_clicks_per_session}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${S[catId].bar}`}
                  style={{ width: `${Math.round((el.pct_sessions / maxPct) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          Dead clicks fired, but no single element hit the ≥2-session ranking threshold.
        </p>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Non-interactive per the extension's tag flag · html/body/main clicks excluded
      </p>
    </LiveCard>
  );
}

function RageClicksCard({ ins, catId, insights }) {
  // INS-C02: bursts of ≥3 rapid clicks on the same element. Ranked by breadth
  // (how many sessions rage-clicked it) rather than depth — a single frustrated
  // user hammering a button 20 times reads as one problem, not 20.
  const rc = insights.rage_clicks;

  if (!rc || rc.total_rage_events === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">0</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">rage clicks on this page</p>
        </div>
        <p className="text-xs text-zinc-400">
          No session clicked the same element 3+ times within 1.5s.
        </p>
      </LiveCard>
    );
  }

  const top = rc.top_elements ?? [];
  const maxPct = top[0]?.pct_sessions ?? 1;

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {rc.pct_sessions_with_rage}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of sessions rage-clicked
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {rc.total_rage_events}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            rage events on this page
          </p>
        </div>
      </div>

      {top.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Most rage-clicked elements
          </p>
          {top.map((el) => (
            <div key={el.key ?? el.element_id}>
              <div className="flex justify-between mb-1 gap-2">
                <span
                  title={el.element_id}
                  className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[160px]"
                >
                  {el.label ?? el.element_id}
                </span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                  {el.pct_sessions}%
                  {el.avg_burst_length > 3 && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · ×{el.avg_burst_length}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${S[catId].bar}`}
                  style={{ width: `${Math.round((el.pct_sessions / maxPct) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          Rage clicks fired, but no element hit the ≥2-session ranking threshold.
        </p>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        Burst = ≥3 clicks on one element with ≤1.5s gaps · ×N shows avg burst length
      </p>
    </LiveCard>
  );
}

function ClickHeatmapCard({ ins, catId, elements }) {
  const clickZones = elements.filter((e) => e.click_count > 0).length;
  const totalClicks = elements.reduce((a, e) => a + e.click_count, 0);
  const topClicked = [...elements].sort((a, b) => b.click_count - a.click_count)[0];

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{totalClicks}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">total clicks</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{clickZones}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">click zones</p>
        </div>
      </div>
      {topClicked && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Top target: <span title={topClicked.element_id} className="font-medium text-zinc-700 dark:text-zinc-300 truncate">{topClicked.label ?? topClicked.element_id}</span>
        </p>
      )}
      <p className={`text-xs font-medium ${S[catId].text}`}>↑ Switch to Click mode in the viewer above</p>
    </LiveCard>
  );
}

function ClickedWithoutLookingCard({ ins, catId, insights }) {
  // INS-GC02: clicks with no prior ≥200ms fixation on the same element in the
  // session — the muscle-memory click. The insight for a brand is precisely
  // that: on these elements label copy is not the lever, because users didn't
  // read it before deciding.
  const cwl = insights.clicked_without_looking;

  if (!cwl || cwl.total_clicks === 0) {
    return (
      <LiveCard ins={ins} catId={catId}>
        <p className="text-xs text-zinc-400">No clicks on this page yet.</p>
      </LiveCard>
    );
  }

  const top = cwl.top_elements ?? [];
  const maxPct = top[0]?.pct_sessions ?? 1;

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex gap-6">
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {cwl.pct_cwl_of_all_clicks}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of clicks had no prior fixation
          </p>
        </div>
        <div>
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {cwl.pct_sessions_with_cwl}%
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            of sessions clicked without looking
          </p>
        </div>
      </div>

      {top.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
            Muscle-memory targets · copy won't change behavior here
          </p>
          {top.map((el) => (
            <div key={el.key ?? el.element_id}>
              <div className="flex justify-between mb-1 gap-2">
                <span
                  title={el.element_id}
                  className="text-xs text-zinc-600 dark:text-zinc-400 truncate max-w-[180px]"
                >
                  {el.label ?? el.element_id}
                  {el.element_tag && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · &lt;{el.element_tag}&gt;
                    </span>
                  )}
                </span>
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 ml-2 flex-shrink-0 tabular-nums">
                  {el.pct_sessions}%
                  {el.click_count > el.sessions_with_cwl && (
                    <span className="text-zinc-400 font-normal">
                      {" "}
                      · {el.click_count} clicks
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${S[catId].bar}`}
                  style={{ width: `${Math.round((el.pct_sessions / maxPct) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400">
          Muscle-memory clicks fired, but no single element hit the ≥2-session ranking threshold.
        </p>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        No prior ≥200ms fixation on the element in the same session
      </p>
    </LiveCard>
  );
}

function LookedButDidntClickCard({ ins, catId, insights }) {
  const items = (insights.looked_not_clicked ?? []).slice(0, 3);

  if (items.length === 0) {
    return (
      <LiveCard ins={ins} catId={catId} wide>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-2.5 py-1 w-fit">
          ⚡ Primary Differentiator
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No friction elements found yet — either all visible elements are converting well, or not enough sessions have been recorded.
        </p>
      </LiveCard>
    );
  }

  const top = items[0];

  return (
    <LiveCard ins={ins} catId={catId} wide>
      <div className="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-full px-2.5 py-1 w-fit">
        ⚡ Primary Differentiator
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Top friction element</p>
          <p className="text-base font-bold text-zinc-900 dark:text-zinc-50 leading-snug">
            {top.pct_looked}% of users fixated on{" "}
            <span title={top.element_id} className={`${S[catId].text} truncate`}>{top.label ?? top.element_id}</span>
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Only <span className="font-semibold text-zinc-700 dark:text-zinc-200">{top.pct_clicked}%</span> clicked —
            the problem is <span className="font-semibold text-amber-600 dark:text-amber-400">persuasion</span>, not visibility.
          </p>
        </div>
        <div className="sm:border-l sm:border-zinc-200 sm:dark:border-zinc-700 sm:pl-4 flex-shrink-0">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">Friction ratio</p>
          <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
            {top.pct_clicked > 0 ? Math.round(top.pct_looked / top.pct_clicked) : "∞"}:1
          </p>
          <p className="text-xs text-zinc-500">saw vs clicked</p>
        </div>
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">All friction elements</p>
        {items.map((item) => (
          <div key={item.key ?? item.element_id} className="flex items-center gap-3 text-xs">
            <span title={item.element_id} className="truncate text-zinc-600 dark:text-zinc-400 w-36 flex-shrink-0">{item.label ?? item.element_id}</span>
            <div className="flex-1 relative h-4 flex items-center">
              <div className={`absolute h-1.5 rounded-full ${S[catId].bar} opacity-20`} style={{ width: `${item.pct_looked}%` }} />
              <div className={`absolute h-1.5 rounded-full ${S[catId].bar}`} style={{ width: `${item.pct_clicked}%` }} />
            </div>
            <span className="text-zinc-400 text-right flex-shrink-0 w-28">
              {item.pct_looked}% saw / {item.pct_clicked}% clicked
            </span>
          </div>
        ))}
        <div className="flex items-center gap-4 pt-1 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-5 rounded-full ${S[catId].bar} opacity-20`} />
            Fixated
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-5 rounded-full ${S[catId].bar}`} />
            Clicked
          </span>
        </div>
      </div>
    </LiveCard>
  );
}

function SessionReplayCard({ ins, catId, insights, projectId }) {
  return (
    <LiveCard ins={ins} catId={catId}>
      <div>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{insights.total_sessions}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">replays available</p>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
        Each replay includes synchronized gaze dot overlay, click indicators, and scroll position.
      </p>
      <Link
        href={`/dashboard/projects/${projectId}/sessions`}
        className={`inline-flex items-center gap-1 text-xs font-medium ${S[catId].text} hover:underline`}
      >
        Browse session replays
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </Link>
    </LiveCard>
  );
}

function EngagementScoreCard({ ins, catId, insights }) {
  const score = insights.avg_engagement_score;
  const label = score >= 70 ? "Good" : score >= 40 ? "Fair" : "Poor";
  const labelStyle =
    score >= 70
      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
      : score >= 40
      ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
      : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
  const barColor = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <LiveCard ins={ins} catId={catId}>
      <div className="flex items-end gap-2">
        <p className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">{score}</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">/ 100</p>
        <span className={`mb-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${labelStyle}`}>{label}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">Avg across {insights.total_sessions} sessions</p>
    </LiveCard>
  );
}

/* ─── insight card router ────────────────────────────────────────────────── */

function InsightCard({ ins, catId, insights, elements, projectId }) {
  if (ins.phase === 2) return <LockedCard ins={ins} catId={catId} />;

  switch (ins.id) {
    case "INS-G01":  return <GazeHeatmapCard       ins={ins} catId={catId} insights={insights} elements={elements} />;
    case "INS-G02":  return <ElementAttentionCard   ins={ins} catId={catId} elements={elements} />;
    case "INS-G03":  return <MissedElementsCard     ins={ins} catId={catId} elements={elements} />;
    case "INS-G04":  return <FirstFixationCard      ins={ins} catId={catId} insights={insights} />;
    case "INS-G05":  return <FixationDurationCard   ins={ins} catId={catId} elements={elements} />;
    case "INS-G06":  return <ScanPathCard           ins={ins} catId={catId} insights={insights} />;
    case "INS-G07":  return <BacktrackingCard       ins={ins} catId={catId} insights={insights} />;
    case "INS-G08":  return <AttentionDropOffCard   ins={ins} catId={catId} insights={insights} />;
    case "INS-S01":  return <ScrollDepthCard        ins={ins} catId={catId} insights={insights} />;
    case "INS-S02":  return <ScrollVelocityCard     ins={ins} catId={catId} insights={insights} />;
    case "INS-S03":  return <ScrollBackCard         ins={ins} catId={catId} insights={insights} />;
    case "INS-S04":  return <FoldAwarenessCard      ins={ins} catId={catId} insights={insights} />;
    case "INS-C01":  return <ClickHeatmapCard       ins={ins} catId={catId} elements={elements} />;
    case "INS-C02":  return <RageClicksCard         ins={ins} catId={catId} insights={insights} />;
    case "INS-C03":  return <DeadClicksCard         ins={ins} catId={catId} insights={insights} />;
    case "INS-C04":  return <LastClickBeforeExitCard ins={ins} catId={catId} insights={insights} />;
    case "INS-GC01": return <LookedButDidntClickCard ins={ins} catId={catId} insights={insights} />;
    case "INS-GC02": return <ClickedWithoutLookingCard ins={ins} catId={catId} insights={insights} />;
    case "INS-SL03": return <SessionReplayCard      ins={ins} catId={catId} insights={insights} projectId={projectId} />;
    case "INS-SL04": return <EngagementScoreCard    ins={ins} catId={catId} insights={insights} />;
    default:         return <LockedCard ins={ins} catId={catId} />;
  }
}

/* ─── main export ────────────────────────────────────────────────────────── */

export default function InsightCatalog({ projectId, insights, elements }) {
  const [activeCat, setActiveCat] = useState("gaze");
  const insightList = ALL_INSIGHTS[activeCat] ?? [];
  const liveCount = insightList.filter((i) => i.phase === 1).length;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Insight Engine</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {TOTAL_INSIGHTS} insights · {liveCount} live in this category · {insightList.length - liveCount} coming in Phase 2
          </p>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-0 border-b border-zinc-200 dark:border-zinc-800 mb-6 overflow-x-auto">
        {CATEGORIES.map((cat) => {
          const active = cat.id === activeCat;
          const cs = S[cat.id];
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 flex-shrink-0 ${
                active
                  ? `${cs.border} ${cs.text}`
                  : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              }`}
            >
              {cat.label}
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? cs.id : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {cat.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insight grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {insightList.map((ins) => (
          <InsightCard
            key={ins.id}
            ins={ins}
            catId={activeCat}
            insights={insights}
            elements={elements}
            projectId={projectId}
          />
        ))}
      </div>
    </div>
  );
}
