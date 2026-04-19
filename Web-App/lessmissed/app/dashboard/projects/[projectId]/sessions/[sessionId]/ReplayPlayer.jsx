"use client";

export default function ReplayPlayer() {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div
        className="relative w-full bg-zinc-100 dark:bg-zinc-800 flex flex-col items-center justify-center gap-4"
        style={{ aspectRatio: "16/9" }}
      >
        <div className="h-14 w-14 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
          <svg className="h-7 w-7 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
          </svg>
        </div>
        <div className="text-center px-8">
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Session replay coming soon</p>
          <p className="text-xs text-zinc-400 mt-1 leading-5">
            Full rrweb-based replay with gaze overlay is in development.<br />
            Session metadata and analytics are available in the sidebar.
          </p>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="shrink-0 h-8 w-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-300 dark:text-zinc-600">
            <svg className="h-4 w-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <span className="shrink-0 text-xs text-zinc-300 dark:text-zinc-600 font-mono">0:00 / —</span>
        </div>
      </div>
    </div>
  );
}
