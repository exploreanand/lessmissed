"use client";

import { useState } from "react";

const states = ["idle", "active", "earned"];

const stateContent = {
  idle: {
    headerBg: "bg-zinc-900",
    headerText: "LessMissed",
    badge: null,
    body: (
      <div className="p-4 space-y-3">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Today&apos;s tasks</p>
        {[
          { brand: "Nike", reward: "20% off", desc: "Explore 3 pages on nike.com", time: "~5 min", isNew: true },
          { brand: "Swiggy", reward: "₹100 off", desc: "Browse 2 restaurant categories", time: "~4 min", isNew: false },
        ].map((task) => (
          <div key={task.brand} className="rounded-xl border border-zinc-700 bg-zinc-800 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-zinc-600 flex items-center justify-center text-xs font-bold text-zinc-300">
                  {task.brand[0]}
                </div>
                <span className="text-sm font-semibold text-zinc-100">{task.brand}</span>
              </div>
              <span className="rounded-full bg-teal-900/60 text-teal-400 text-xs px-2 py-0.5 font-semibold">
                {task.reward}
              </span>
            </div>
            <p className="mt-2 text-xs text-zinc-400">{task.desc}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-zinc-500">{task.time}</span>
              {task.isNew && <span className="text-xs text-violet-400">New today</span>}
            </div>
          </div>
        ))}
      </div>
    ),
    footer: (
      <div className="border-t border-zinc-700 px-4 py-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        <span className="text-xs text-zinc-500">Camera off · Not tracking</span>
      </div>
    ),
    cta: { label: "Start Nike task →", nextState: "active" },
  },
  active: {
    headerBg: "bg-green-800",
    headerText: "LessMissed",
    badge: "Recording",
    body: (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-zinc-600 flex items-center justify-center text-xs font-bold text-zinc-300">N</div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Nike · 20% off</p>
            <p className="text-xs text-zinc-400">Explore 3 pages on nike.com</p>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-400">Progress</span>
            <span className="text-xs text-zinc-300">1 of 3 pages visited</span>
          </div>
          <div className="flex gap-2 mb-2">
            {["Home", "Collection", "Product"].map((page, i) => (
              <span
                key={page}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  i === 0
                    ? "bg-green-900/60 text-green-400"
                    : i === 1
                    ? "bg-blue-900/60 text-blue-400"
                    : "bg-zinc-700 text-zinc-500"
                }`}
              >
                {page}
              </span>
            ))}
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-green-500" />
          </div>
        </div>
      </div>
    ),
    footer: (
      <div className="border-t border-zinc-700 px-4 py-2 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs text-zinc-400">Camera on · Tracking nike.com only</span>
      </div>
    ),
    cta: { label: "Task complete! →", nextState: "earned" },
  },
  earned: {
    headerBg: "bg-teal-800",
    headerText: "LessMissed",
    badge: "Completed",
    body: (
      <div className="p-4 text-center space-y-3">
        <div className="text-3xl">🎉</div>
        <p className="text-sm font-bold text-zinc-100">Reward earned!</p>
        <div className="rounded-xl border border-teal-700 bg-teal-900/40 p-3">
          <p className="text-2xl font-bold text-teal-300">20% off Nike</p>
          <p className="text-xs text-teal-400 mt-1">Coupon added to your wallet</p>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-lg bg-zinc-800 p-2 text-center">
            <p className="text-xs text-zinc-400">Total earned</p>
            <p className="text-sm font-bold text-zinc-100">4 rewards</p>
          </div>
          <div className="rounded-lg bg-zinc-800 p-2 text-center">
            <p className="text-xs text-zinc-400">New brands</p>
            <p className="text-sm font-bold text-zinc-100">3 available</p>
          </div>
        </div>
      </div>
    ),
    footer: (
      <div className="border-t border-zinc-700 px-4 py-2 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        <span className="text-xs text-zinc-500">Camera off · Not tracking</span>
      </div>
    ),
    cta: { label: "Try again →", nextState: "idle" },
  },
};

export default function ExtensionDemo() {
  const [state, setState] = useState("idle");
  const content = stateContent[state];

  return (
    <div className="flex flex-col items-center gap-8">
      {/* State indicators */}
      <div className="flex gap-2">
        {states.map((s) => (
          <button
            key={s}
            onClick={() => setState(s)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all capitalize ${
              state === s
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Extension popup */}
      <div className="w-72 rounded-2xl border border-zinc-700 bg-zinc-900 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className={`${content.headerBg} px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-sm font-bold text-white">{content.headerText}</span>
          </div>
          {content.badge && (
            <span className="rounded-full bg-white/20 text-white text-xs px-2 py-0.5 font-medium">
              {content.badge}
            </span>
          )}
        </div>

        {/* Body */}
        {content.body}

        {/* Footer */}
        {content.footer}
      </div>

      {/* CTA button */}
      <button
        onClick={() => setState(content.cta.nextState)}
        className="rounded-full bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-500 transition-all"
      >
        {content.cta.label}
      </button>
      <p className="text-xs text-zinc-400">Interactive mockup — no real extension installed</p>
    </div>
  );
}
