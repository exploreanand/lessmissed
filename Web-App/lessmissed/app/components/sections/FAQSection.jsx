"use client";

import { useState } from "react";

export default function FAQSection({ items, heading = "Frequently asked questions" }) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section className="py-24 bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-center mb-12">
          {heading}
        </h2>
        <dl className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              <dt>
                <button
                  className="flex w-full items-center justify-between px-6 py-4 text-left text-sm font-semibold text-zinc-900 dark:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  aria-expanded={openIndex === i}
                >
                  <span>{item.q}</span>
                  <svg
                    className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${openIndex === i ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </dt>
              {openIndex === i && (
                <dd className="px-6 pb-5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
                  {item.a}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
