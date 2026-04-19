import Link from "next/link";
import { connectDB } from "@/lib/mongoose";
import Coupon from "@/lib/models/Coupon";

function statusBadge(status) {
  const styles = {
    active: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400",
    redeemed_out: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    paused: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
    expired: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return styles[status] ?? styles.expired;
}

function couponTypeLabel(c) {
  if (c.type === "percentage") return `${c.value}% off`;
  if (c.type === "fixed") return `₹${c.value} off`;
  if (c.type === "free_delivery") return "Free delivery";
  return c.type;
}

export default async function CouponsPage() {
  await connectDB();
  const coupons = await Coupon.find({}).sort({ created_at: -1 }).lean();

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Coupons</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage the rewards you offer to consumers
          </p>
        </div>
        <Link
          href="/dashboard/coupons/new"
          className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New coupon
        </Link>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              {["Code", "Type", "Earned / Cap", "Expiry", "Min order", "Status"].map((h) => (
                <th
                  key={h}
                  className="text-left px-5 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {coupons.map((c) => {
              const earned = c.stats?.total_earned ?? 0;
              const cap = c.rules?.max_redemptions ?? 0;
              const usedPct = cap > 0 ? Math.round((earned / cap) * 100) : 0;
              const expiry = c.rules?.expiry_date
                ? new Date(c.rules.expiry_date).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "—";

              return (
                <tr
                  key={c._id.toString()}
                  className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors"
                >
                  <td className="px-5 py-4">
                    <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-50">
                      {c.code}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-zinc-600 dark:text-zinc-400">{couponTypeLabel(c)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-600 dark:text-zinc-400 text-xs">
                        {earned}/{cap}
                      </span>
                      <div className="h-1.5 w-20 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${usedPct >= 90 ? "bg-amber-500" : "bg-violet-500"}`}
                          style={{ width: `${Math.min(usedPct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400 text-xs">{expiry}</td>
                  <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400 text-xs">
                    {c.rules?.min_order_value ? `₹${c.rules.min_order_value}` : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusBadge(c.status)}`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {coupons.length === 0 && (
          <div className="py-16 text-center text-sm text-zinc-400">
            No coupons yet.{" "}
            <Link href="/dashboard/coupons/new" className="text-violet-500 hover:underline">
              Create one
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
