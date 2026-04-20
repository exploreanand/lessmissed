"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STEPS = ["Project details", "Target pages", "Create task", "Add reward"];

function slugFromPath(path) {
  const seg = path.replace(/^\//, "").split("/")[0].replace(/[^a-z0-9-]/gi, "");
  return seg || "home";
}

function parsePaths(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/"));
}

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    projectName: "",
    projectUrl: "",
    targetPages: "",
    taskName: "",
    taskPages: "",
    couponType: "percent",
    couponValue: "",
    couponCode: "",
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.userId) setClientId(d.userId); })
      .catch(() => {});
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleFinish() {
    if (!clientId) {
      setError("Session expired — please log in again.");
      return;
    }

    const domain = form.projectUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const targetPaths = parsePaths(form.targetPages);
    if (!form.projectName || !domain) {
      setError("Project name and URL are required.");
      setStep(0);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // 1. Create project
      const pages = targetPaths.map((path) => ({
        path,
        slug: slugFromPath(path),
        type: path.includes(":") || path.includes("*") ? "wildcard" : "exact",
      }));

      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, name: form.projectName, domain, pages }),
      });
      if (!projRes.ok) throw new Error("Failed to create project");
      const project = await projRes.json();
      const projectId = project._id;

      // 2. Create task (if name provided)
      let couponId = null;
      const taskPaths = parsePaths(form.taskPages || form.targetPages);

      if (form.taskName) {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 90);

        const taskRes = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            client_id: clientId,
            title: form.taskName,
            pages: taskPaths,
            schedule: {
              start_date: now.toISOString(),
              end_date: endDate.toISOString(),
              daily_cap: 20,
              total_cap: 500,
            },
          }),
        });
        if (!taskRes.ok) throw new Error("Failed to create task");
        const task = await taskRes.json();

        // 3. Create coupon if specified
        if (form.couponType !== "none" && form.couponCode) {
          const typeMap = { percent: "percentage", fixed: "fixed", free_delivery: "free_delivery" };
          const expiry = new Date();
          expiry.setDate(expiry.getDate() + 90);

          const couponRes = await fetch("/api/coupons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              client_id: clientId,
              project_id: projectId,
              task_id: task._id,
              type: typeMap[form.couponType] ?? "custom",
              value: form.couponValue ? Number(form.couponValue) : null,
              code: form.couponCode.toUpperCase(),
              rules: {
                max_redemptions: 100,
                expiry_date: expiry.toISOString(),
                min_order_value: 0,
              },
            }),
          });
          if (couponRes.ok) {
            const coupon = await couponRes.json();
            couponId = coupon._id;
            // Link coupon to task
            await fetch(`/api/tasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ coupon_id: couponId }),
            }).catch(() => {});
          }
        }
      }

      router.push(`/dashboard/projects/${projectId}`);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Set up your project</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">4 steps to your first gaze insights</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-10 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-shrink-0">
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
              <span className={`text-sm font-medium hidden sm:inline shrink-0 ${i === step ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400"}`}>{label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8">

        {error && (
          <div className="mb-5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Step 1: Project details */}
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Tell us about your project</h2>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Project name</label>
              <input
                type="text"
                value={form.projectName}
                onChange={(e) => update("projectName", e.target.value)}
                placeholder="Acme Store"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Website URL</label>
              <input
                type="url"
                value={form.projectUrl}
                onChange={(e) => update("projectUrl", e.target.value)}
                placeholder="https://yourstore.com"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>
        )}

        {/* Step 2: Target pages */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add target pages</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Enter the URL paths on your site you want to track. The LessMissed extension handles everything — no code changes needed on your website.
            </p>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Pages to track <span className="text-zinc-400 font-normal">(one per line — exact paths or wildcards)</span>
              </label>
              <textarea
                value={form.targetPages}
                onChange={(e) => update("targetPages", e.target.value)}
                rows={5}
                placeholder={"/\n/products/:id\n/cart\n/checkout\n/blog/*"}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              />
            </div>
            <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-4 text-sm text-violet-800 dark:text-violet-300 space-y-1.5">
              <p><strong>How it works:</strong> When a consumer starts a task, our Chrome extension activates on these pages only.</p>
              <p>The extension automatically captures a full-page screenshot and streams gaze, click, and scroll data — giving you accurate heatmaps without any changes to your website.</p>
            </div>
          </div>
        )}

        {/* Step 3: First task */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create your first task</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">A task tells consumers which pages to visit. You can create more detailed tasks later.</p>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Task name</label>
              <input
                type="text"
                value={form.taskName}
                onChange={(e) => update("taskName", e.target.value)}
                placeholder="Explore the homepage"
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Pages to track <span className="text-zinc-400 font-normal">(one per line — leave blank to use target pages above)</span></label>
              <textarea
                value={form.taskPages}
                onChange={(e) => update("taskPages", e.target.value)}
                rows={4}
                placeholder={"/\n/products/:id\n/cart"}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              />
            </div>
          </div>
        )}

        {/* Step 4: Coupon */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Add a reward coupon</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Consumers earn this when they complete your task. You can skip this and add coupons later.</p>

            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "percent", label: "% Off" },
                { key: "fixed", label: "Fixed amount" },
                { key: "free_delivery", label: "Free delivery" },
                { key: "none", label: "Skip for now" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => update("couponType", t.key)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium text-center transition-colors ${
                    form.couponType === t.key
                      ? "border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {form.couponType !== "none" && (
              <div className="space-y-4">
                {form.couponType !== "free_delivery" && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      {form.couponType === "percent" ? "Discount %" : "Discount (₹)"}
                    </label>
                    <input
                      type="number"
                      value={form.couponValue}
                      onChange={(e) => update("couponValue", e.target.value)}
                      placeholder={form.couponType === "percent" ? "20" : "100"}
                      className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Coupon code</label>
                  <input
                    type="text"
                    value={form.couponCode}
                    onChange={(e) => update("couponCode", e.target.value.toUpperCase())}
                    placeholder="WELCOME20"
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-5 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 disabled:opacity-40 transition-colors"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className="rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-60 transition-colors"
            >
              {submitting ? "Creating…" : "Create project →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}