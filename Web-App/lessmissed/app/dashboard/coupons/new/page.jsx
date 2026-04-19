"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [
  { key: "percent",       label: "% Off",           placeholder: "20" },
  { key: "fixed",         label: "Fixed amount",    placeholder: "100" },
  { key: "free_delivery", label: "Free delivery",   placeholder: null },
  { key: "custom",        label: "Custom text",     placeholder: "Buy 1 Get 1" },
];

function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function NewCouponPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    type: "percent",
    value: "",
    code: "",
    cap: 100,
    expiresAt: "",
    minOrderValue: "",
  });

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const selectedType = TYPES.find((t) => t.key === form.type);

  function handleSubmit(e) {
    e.preventDefault();
    // TODO: POST /api/coupons
    router.push("/dashboard/coupons");
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">New coupon</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Create a reward coupon for consumers who complete your tasks</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Type selector */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">Discount type</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => update("type", t.key)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium text-center transition-colors ${
                      form.type === t.key
                        ? "border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Fields */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Coupon code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => update("code", e.target.value.toUpperCase())}
                    placeholder="SUMMER20"
                    maxLength={20}
                    className="flex-1 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm font-mono text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => update("code", generateCode())}
                    className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-3.5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 transition-colors"
                  >
                    Generate
                  </button>
                </div>
              </div>

              {/* Value */}
              {selectedType?.placeholder !== null && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    {form.type === "percent" ? "Discount %" : form.type === "fixed" ? "Discount amount (₹)" : "Custom text"}
                  </label>
                  <input
                    type={form.type === "custom" ? "text" : "number"}
                    value={form.value}
                    onChange={(e) => update("value", e.target.value)}
                    placeholder={selectedType.placeholder}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              )}

              {/* Cap + Expiry */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Redemption cap</label>
                  <input
                    type="number"
                    min={1}
                    value={form.cap}
                    onChange={(e) => update("cap", Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Expiry date</label>
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => update("expiresAt", e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>
              </div>

              {/* Min order */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Minimum order value (₹) <span className="text-zinc-400 font-normal">— optional</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.minOrderValue}
                  onChange={(e) => update("minOrderValue", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 sm:flex-none rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
              >
                Create coupon
              </button>
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 h-fit">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Consumer preview</p>
            <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-4 text-center">
              <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">
                {form.type === "percent" && form.value ? `${form.value}% off` :
                 form.type === "fixed" && form.value ? `₹${form.value} off` :
                 form.type === "free_delivery" ? "Free delivery" :
                 form.value || "Reward"}
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-teal-600 dark:text-teal-400">{form.code || "CODE"}</p>
              {form.minOrderValue && (
                <p className="mt-1 text-xs text-teal-500 dark:text-teal-500">Min. order ₹{form.minOrderValue}</p>
              )}
              {form.expiresAt && (
                <p className="mt-1 text-xs text-teal-500 dark:text-teal-500">Expires {form.expiresAt}</p>
              )}
            </div>
            <p className="mt-3 text-xs text-zinc-400 text-center">How it appears in the consumer wallet</p>
          </div>
        </div>
      </form>
    </div>
  );
}
