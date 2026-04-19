// rows: [{ feature, competitors: [val1, val2, ...] }]
// competitors: ["Hotjar / Clarity", "LessMissed"]
// The LAST competitor is assumed to be LessMissed (gets the highlight column)

export default function ComparisonTable({ rows, competitors, heading = "LessMissed vs traditional tools" }) {
  return (
    <section className="py-24 bg-zinc-50 dark:bg-zinc-900">
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-center mb-12">
          {heading}
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-6 py-4 text-left font-semibold text-zinc-900 dark:text-zinc-50 bg-white dark:bg-zinc-950 w-1/3">
                  Feature
                </th>
                {competitors.map((c, i) => (
                  <th
                    key={c}
                    className={`px-6 py-4 text-center font-semibold ${
                      i === competitors.length - 1
                        ? "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300"
                        : "bg-white text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
                    }`}
                  >
                    {c}
                    {i === competitors.length - 1 && (
                      <span className="ml-2 rounded-full bg-violet-600 px-2 py-0.5 text-xs text-white font-medium">us</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                >
                  <td className="px-6 py-4 text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-950 font-medium">
                    {row.feature}
                  </td>
                  {row.competitors.map((val, ci) => (
                    <td
                      key={ci}
                      className={`px-6 py-4 text-center ${
                        ci === row.competitors.length - 1
                          ? "bg-violet-50 dark:bg-violet-950/30"
                          : "bg-white dark:bg-zinc-950"
                      }`}
                    >
                      {val === true || val === "Yes" ? (
                        <span className="inline-flex items-center justify-center">
                          <svg className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </span>
                      ) : val === false || val === "No" ? (
                        <span className="inline-flex items-center justify-center">
                          <svg className="h-5 w-5 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </span>
                      ) : (
                        <span className="text-zinc-700 dark:text-zinc-300">{val}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
