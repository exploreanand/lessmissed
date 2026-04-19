export default function HealthBadge({ score }) {
  const color =
    score >= 70
      ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-400"
      : score >= 40
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
      : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {score}
    </span>
  );
}
