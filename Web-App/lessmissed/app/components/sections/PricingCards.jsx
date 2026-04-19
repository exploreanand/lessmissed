import Link from "next/link";

// Static plan data — TODO: move to CMS if pricing changes frequently
const plans = [
  {
    name: "Starter",
    price: "Free",
    priceDetail: "forever",
    tagline: "Try it out. No credit card.",
    features: {
      teaser: ["3 tasks/month", "50 sessions", "1 project", "Basic heatmaps"],
      compact: ["3 tasks/month", "50 sessions", "1 project", "Basic heatmaps", "7-day data retention"],
      full: ["3 tasks/month", "50 sessions", "1 project", "Basic heatmaps", "7-day data retention", "Email support"],
    },
    cta: "Get started free",
    href: "/signup",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$99",
    priceDetail: "per month",
    tagline: "For teams that need real data.",
    features: {
      teaser: ["Unlimited tasks", "500 sessions/mo", "5 projects", "Session replays"],
      compact: ["Unlimited tasks", "500 sessions/mo", "5 projects", "Session replays", "Element insights", "90-day retention"],
      full: ["Unlimited tasks", "500 sessions/mo", "5 projects", "Session replays", "Element-level insights", "90-day data retention", "Priority support", "Team seats (3)"],
    },
    cta: "Start free trial",
    href: "/signup?plan=growth",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    priceDetail: "talk to us",
    tagline: "For large UX teams & agencies.",
    features: {
      teaser: ["Unlimited everything", "API access", "SSO", "Dedicated support"],
      compact: ["Unlimited everything", "API access", "SSO", "Dedicated support", "Unlimited retention"],
      full: ["Unlimited sessions & tasks", "Unlimited projects", "API access", "SSO / SAML", "Dedicated support", "Unlimited data retention", "Custom seats", "SLA guarantee"],
    },
    cta: "Contact sales",
    href: "/contact",
    highlighted: false,
  },
];

export default function PricingCards({ variant = "full" }) {
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
      {plans.map((plan) => (
        <div
          key={plan.name}
          className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
            plan.highlighted
              ? "border-violet-600 ring-2 ring-violet-600 -translate-y-2 shadow-xl shadow-violet-500/10"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
          {plan.highlighted && (
            <div className="absolute -top-4 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-violet-600 px-4 py-1 text-xs font-semibold text-white">
                Most popular
              </span>
            </div>
          )}

          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{plan.name}</h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{plan.price}</span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{plan.priceDetail}</span>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{plan.tagline}</p>
          </div>

          <ul className="mt-6 flex-1 space-y-3">
            {plan.features[variant].map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <svg className="h-4 w-4 shrink-0 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>

          <Link
            href={plan.href}
            className={`mt-8 block rounded-full px-5 py-2.5 text-center text-sm font-semibold transition-all ${
              plan.highlighted
                ? "bg-violet-600 text-white hover:bg-violet-500"
                : "border border-zinc-300 text-zinc-700 hover:border-violet-500 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {plan.cta}
          </Link>
        </div>
      ))}

      {variant === "teaser" && (
        <div className="col-span-full text-center mt-2">
          <Link href="/pricing" className="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
            See full pricing details →
          </Link>
        </div>
      )}
    </div>
  );
}
