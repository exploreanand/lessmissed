export default function StatCard({ label, value, delta, icon }) {
  const deltaPositive = delta && delta.startsWith("+");
  const deltaNegative = delta && delta.startsWith("-");

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</p>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{value}</p>
      {delta && (
        <p className={`mt-1 text-xs font-medium ${
          deltaPositive ? "text-teal-600 dark:text-teal-400"
          : deltaNegative ? "text-red-600 dark:text-red-400"
          : "text-zinc-500"
        }`}>
          {delta} vs last 30 days
        </p>
      )}
    </div>
  );
}
