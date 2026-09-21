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
    { id: "INS-G05", name: "Fixation Duration per Element", phase: 2, desc: "Average and median dwell time per element. Long fixation = interest OR confusion (context-dependent)." },
    { id: "INS-G06", name: "Scan Path / Reading Order",     phase: 2, desc: "Most common fixation subsequences across sessions. Reveals actual vs intended reading flow." },
    { id: "INS-G07", name: "Backtracking / Re-reading",     phase: 2, desc: "User returns to a previously fixated element. Signals confusion or comparison behavior." },
    { id: "INS-G08", name: "Attention Drop-off Point",      phase: 2, desc: "Page decile where fixation rate drops below 50%. Different from scroll depth — users may scroll past without looking." },
  ],
  scroll: [
    { id: "INS-S01", name: "Scroll Depth",        phase: 1, desc: "Max scroll depth per session, averaged. Horizontal markers at 25/50/75/100% reach." },
    { id: "INS-S02", name: "Scroll Velocity Map",  phase: 2, desc: "Average scroll velocity per page decile. Fast = skimmed, slow = read carefully." },
    { id: "INS-S03", name: "Scroll-Back Events",   phase: 2, desc: "Count per page section. Identifies content that pulls users back up the page." },
    { id: "INS-S04", name: "Fold Awareness",        phase: 2, desc: "Scroll depth + element fixation combined. Net visibility per element below the fold." },
  ],
  click: [
    { id: "INS-C01", name: "Click Heatmap",          phase: 1, desc: "Aggregated click coordinates. Separate overlay from gaze heatmap — toggle in the viewer above." },
    { id: "INS-C02", name: "Rage Clicks",             phase: 2, desc: "3+ clicks on same element within 1500ms. Frustration signal on broken interactions." },
    { id: "INS-C03", name: "Dead Clicks",             phase: 2, desc: "Clicks on non-interactive elements. Reveals misleading affordances in your UI." },
    { id: "INS-C04", name: "Last Click Before Exit",  phase: 2, desc: "Final click in sessions ending without task completion. Identifies conversion killers." },
  ],
  gaze_click: [
    { id: "INS-GC01", name: "Looked But Didn't Click",   phase: 1, primary: true, desc: "Elements with fixation > 0 but click == 0. Problem is persuasion, not visibility." },
    { id: "INS-GC02", name: "Clicked Without Looking",    phase: 2, desc: "Click without preceding 200ms fixation. Muscle memory click — label copy doesn't matter for this element." },
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

function ScrollDepthCard({ ins, catId, insights }) {
  const avg = insights.avg_scroll_depth_pct;
  const reach = insights.scroll_reach ?? {};
  const quartiles = [
    { label: "25%", reach: reach[25] ?? 0 },
    { label: "50%", reach: reach[50] ?? 0 },
    { label: "75%", reach: reach[75] ?? 0 },
    { label: "100%", reach: reach[100] ?? 0 },
  ];

  return (
    <LiveCard ins={ins} catId={catId}>
      <div>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{avg}%</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">avg scroll depth</p>
      </div>
      <div className="space-y-2">
        {quartiles.map((q) => (
          <div key={q.label} className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-500 w-9 flex-shrink-0">{q.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div className={`h-full rounded-full ${S[catId].bar}`} style={{ width: `${q.reach}%` }} />
            </div>
            <span className="text-xs text-zinc-500 w-8 text-right flex-shrink-0">{q.reach}%</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-400 dark:text-zinc-500">% of sessions reaching each page depth</p>
      <p className={`text-xs font-medium ${S[catId].text}`}>↑ Switch to Scroll mode in the viewer above</p>
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
    case "INS-S01":  return <ScrollDepthCard        ins={ins} catId={catId} insights={insights} />;
    case "INS-C01":  return <ClickHeatmapCard       ins={ins} catId={catId} elements={elements} />;
    case "INS-GC01": return <LookedButDidntClickCard ins={ins} catId={catId} insights={insights} />;
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
