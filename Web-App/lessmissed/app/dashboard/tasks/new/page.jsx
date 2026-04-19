"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STEPS = ["Task details", "Select pages", "Attach coupon", "Schedule"];

export default function NewTaskPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [projects, setProjects] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    projectId: "",
    selectedPages: [],
    couponId: null,
    dailyCap: 20,
    startDate: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((data) => {
      const list = Array.isArray(data) ? data : (data.projects ?? []);
      setProjects(list);
      if (list.length > 0) setForm((f) => ({ ...f, projectId: list[0]._id.toString() }));
    }).catch(() => {});

    fetch("/api/coupons").then((r) => r.json()).then((data) => {
      setCoupons(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, []);

  const selectedProject = projects.find((p) => p._id.toString() === form.projectId);
  const projectPages = selectedProject?.pages ?? [];

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function togglePage(path) {
    setForm((f) => ({
      ...f,
      selectedPages: f.selectedPages.includes(path)
        ? f.selectedPages.filter((p) => p !== path)
        : [...f.selectedPages, path],
    }));
  }

  async function publish() {
    if (!form.name || !form.projectId) {
      setError("Task name and project are required.");
      setStep(0);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const now = new Date(form.startDate);
      const end = new Date(now);
      end.setDate(end.getDate() + 90);

      const body = {
        project_id: form.projectId,
        title: form.name,
        description: form.description,
        pages: form.selectedPages.length > 0 ? form.selectedPages : projectPages.map((p) => p.path),
        coupon_id: form.couponId ?? undefined,
        schedule: {
          start_date: now.toISOString(),
          end_date: end.toISOString(),
          daily_cap: form.dailyCap,
          total_cap: form.dailyCap * 30,
        },
      };

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create task");
      router.push(`/dashboard/projects/${form.projectId}`);
    } catch (err) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Create task</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Define a browsing task for consumers to earn a reward</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-10 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 shrink-0">
            {i > 0 && <div className={`h-px w-8 ${i <= step ? "bg-violet-400" : "bg-zinc-200 dark:bg-zinc-700"}`} />}
            <div className="flex items-center gap-2">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i < step ? "bg-teal-500 text-white"
                : i === step ? "bg-violet-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
              }`}>
                {i < step ? (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : i + 1}
              </div>
              <span className={`text-sm font-medium hidden sm:inline ${i === step ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400"}`}>{label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">

            {error && (
              <div className="mb-5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Step 1: Details */}
            {step === 0 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Task details</h2>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Project</label>
                  <select
                    value={form.projectId}
                    onChange={(e) => update("projectId", e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  >
                    {projects.map((p) => <option key={p._id} value={p._id.toString()}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Task name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="e.g. Explore summer collection"
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Description <span className="text-zinc-400 font-normal">(shown to consumer)</span></label>
                  <textarea
                    value={form.description}
                    onChange={(e) => update("description", e.target.value)}
                    rows={3}
                    placeholder="Browse the homepage and check out the summer sale section"
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Step 2: Pages */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Select pages to track</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose which pages the consumer must visit. Leave all unchecked to use all project pages.</p>
                <div className="space-y-2">
                  {projectPages.length === 0 ? (
                    <p className="text-sm text-zinc-400">No pages found for this project.</p>
                  ) : projectPages.map((p) => (
                    <label key={p.path} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:border-violet-300 dark:hover:border-violet-700 transition-colors">
                      <input
                        type="checkbox"
                        checked={form.selectedPages.includes(p.path)}
                        onChange={() => togglePage(p.path)}
                        className="h-4 w-4 rounded accent-violet-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 font-mono">{p.path}</p>
                        <p className="text-xs text-zinc-400">{p.session_count ?? 0} past sessions</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Coupon */}
            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Attach a reward coupon</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Consumers earn this coupon when they complete the task.</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:border-violet-300 dark:hover:border-violet-700 transition-colors">
                    <input type="radio" name="coupon" checked={form.couponId === null} onChange={() => update("couponId", null)} className="h-4 w-4 accent-violet-600" />
                    <div>
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No coupon</p>
                      <p className="text-xs text-zinc-400">Task has no reward</p>
                    </div>
                  </label>
                  {coupons.filter((c) => c.status === "active").map((c) => (
                    <label key={c._id} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:border-violet-300 dark:hover:border-violet-700 transition-colors">
                      <input type="radio" name="coupon" checked={form.couponId === c._id.toString()} onChange={() => update("couponId", c._id.toString())} className="h-4 w-4 accent-violet-600" />
                      <div>
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 font-mono">{c.code}</p>
                        <p className="text-xs text-zinc-400">
                          {c.type === "percentage" ? `${c.value}% off` : c.type === "fixed" ? `₹${c.value} off` : "Free delivery"}
                          {" · "}{c.stats?.total_earned ?? 0}/{c.rules?.max_redemptions ?? 0} used
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Step 4: Schedule */}
            {step === 3 && (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Schedule & limits</h2>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Start date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => update("startDate", e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Daily cap <span className="text-zinc-400 font-normal">(max sessions per day)</span></label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={form.dailyCap}
                    onChange={(e) => update("dailyCap", Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-4 text-sm text-violet-800 dark:text-violet-200">
                  At a daily cap of <strong>{form.dailyCap}</strong>, you&apos;ll collect up to <strong>{form.dailyCap * 30} sessions/month</strong>.
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8 pt-5 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 disabled:opacity-40 transition-colors"
              >
                Back
              </button>
              {step < STEPS.length - 1 ? (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
                >
                  Continue →
                </button>
              ) : (
                <button
                  onClick={publish}
                  disabled={submitting}
                  className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-60 transition-colors"
                >
                  {submitting ? "Publishing…" : "Publish task"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 h-fit">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Preview</p>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{form.name || "Task name"}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{form.description || "Task description will appear here"}</p>
            {form.selectedPages.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {form.selectedPages.map((path) => (
                  <span key={path} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">{path}</span>
                ))}
              </div>
            )}
            {form.couponId && (
              <div className="rounded-lg bg-teal-50 dark:bg-teal-900/30 px-3 py-2">
                <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                  Reward: {coupons.find((c) => c._id.toString() === form.couponId)?.code}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
