"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { normalizePath } from "@/lib/pathTemplate";

const STEPS = ["Project details", "Target pages", "Create task", "Add reward"];

/**
 * One entry per non-empty line, whatever shape it is in.
 *
 * The server resolves each against the project's domain, so a full URL pasted
 * from the browser bar, a bare host and a plain path all work. The previous
 * version kept only lines starting with "/", which meant pasting
 * "https://site.com/pricing" — the single most likely thing an admin does —
 * added nothing at all and reported no error.
 */
function parseTargets(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Set when the project was created but some pages were rejected, so the admin
  // can read what happened and then continue under their own steam.
  const [createdProjectId, setCreatedProjectId] = useState(null);

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
    const targetUrls = parseTargets(form.targetPages);
    if (!form.projectName || !domain) {
      setError("Project name and URL are required.");
      setStep(0);
      return;
    }
    if (!targetUrls.length) {
      setError("Add at least one page to track.");
      setStep(1);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // 1. Create the project and register its target pages in one call.
      //
      // The pages are no longer built here. The server runs each URL through
      // addTargetPage — the same path the dashboard's "Add page" uses — which
      // validates it, stores the concrete capture_url and queues the baseline.
      // Building the subdocuments client-side is what left first-setup pages
      // with no capture_url and no job, so they were never photographed until
      // the admin re-added them from the dashboard.
      const projRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.projectName, domain, target_urls: targetUrls }),
      });
      if (!projRes.ok) {
        const detail = await projRes.json().catch(() => ({}));
        throw new Error(detail.error || "Failed to create project");
      }
      const project = await projRes.json();
      const projectId = project._id;

      // A URL the server could not accept (wrong domain, unreachable) does not
      // fail the project, but the admin must be told rather than left to notice
      // a missing page later.
      const rejected = (project.target_pages ?? []).filter((p) => !p.ok);

      // 2. Create task (if name provided)
      let couponId = null;
      // Task.pages holds path templates, not URLs — normalise, because the
      // target box now accepts full URLs.
      const taskPaths = parseTargets(form.taskPages || form.targetPages).map((entry) =>
        normalizePath(entry)
      );

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

      // Everything accepted — straight to the project, where the previews are
      // already being prepared.
      if (!rejected.length) {
        router.push(`/dashboard/projects/${projectId}`);
        return;
      }

      // Otherwise stop here and say which pages did not make it. Navigating
      // away would leave the admin to discover the gap on their own.
      setCreatedProjectId(projectId);
      setError(
        `Project created, but ${rejected.length} page${rejected.length > 1 ? "s" : ""} could not be added:\n` +
          rejected.map((p) => `• ${p.url} — ${p.error}`).join("\n")
      );
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
            {/* whitespace-pre-line so a per-URL rejection list stays readable */}
            <p className="whitespace-pre-line">{error}</p>
            {createdProjectId && (
              <button
                type="button"
                onClick={() => router.push(`/dashboard/projects/${createdProjectId}`)}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                Continue to project →
              </button>
            )}
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
              These are the pages LessMissed reports on. Everything else on your site is ignored,
              so start with the ones that matter — your homepage, pricing, a key landing page.
              No code changes needed on your website.
            </p>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Pages to track <span className="text-zinc-400 font-normal">(one per line — paste a URL or type a path)</span>
              </label>
              <textarea
                value={form.targetPages}
                onChange={(e) => update("targetPages", e.target.value)}
                rows={5}
                placeholder={`https://${form.projectUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "") || "yoursite.com"}/\n/pricing\n/products/8812`}
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              />
            </div>
            <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-4 text-sm text-violet-800 dark:text-violet-300 space-y-1.5">
              <p><strong>What happens next:</strong> each page is checked and a preview of it is prepared automatically. You can add more, or take a fresh preview, any time from the project.</p>
              <p>For a page that stands for many — a product, a blog post — give one real example. <code>/products/8812</code> becomes <code>/products/:id</code>, one row covering every product, previewed from the URL you gave.</p>
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
              onClick={() => {
                // Validate on the step that owns the field, rather than bouncing
                // the admin back here from the final screen.
                if (step === 0 && (!form.projectName.trim() || !form.projectUrl.trim())) {
                  setError("Project name and site URL are required.");
                  return;
                }
                if (step === 1 && !parseTargets(form.targetPages).length) {
                  setError("Add at least one page to track — this is what LessMissed captures.");
                  return;
                }
                setError("");
                setStep((s) => s + 1);
              }}
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