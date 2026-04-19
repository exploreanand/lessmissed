import Link from "next/link";
import PricingCards from "../components/sections/PricingCards";
import ComparisonTable from "../components/sections/ComparisonTable";
import FinalCTA from "../components/sections/FinalCTA";

// TODO: Replace with API fetch from brand database (spec §4.1 Section 7)
const featuredBrands = [
  { name: "Nike", reward: "20% off" },
  { name: "Swiggy", reward: "₹100 off" },
  { name: "Zomato", reward: "Free delivery ×3" },
  { name: "Myntra", reward: "15% off" },
  { name: "Nykaa", reward: "₹200 off" },
  { name: "Flipkart", reward: "10% off" },
  { name: "Meesho", reward: "₹50 off" },
  { name: "Boat", reward: "12% off" },
];

// Duplicate for seamless scroll loop
const brandsLoop = [...featuredBrands, ...featuredBrands];

// TODO: Replace with API fetch for trust stats (spec §4.1 Section 3)
const trustStats = [
  { value: "4,200+", label: "users earning rewards" },
  { value: "87", label: "brands getting insights" },
];

const comparisonRows = [
  { feature: "Click heatmaps", competitors: ["Yes", "Yes"] },
  { feature: "Gaze heatmaps", competitors: ["No", "Yes"] },
  { feature: "Attention per element", competitors: ["No", "Yes"] },
  { feature: "Built-in participant recruitment", competitors: ["No", "Yes — reward marketplace"] },
  { feature: "Session replays with gaze dot", competitors: ["No", "Yes"] },
  { feature: "Confusion / hesitation detection", competitors: ["No", "Yes"] },
];

const brandFeatureCards = [
  {
    title: "Gaze heatmaps",
    desc: "See where real users look on your pages. Not clicks — actual eye fixations mapped to every pixel.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: "Session replays with gaze",
    desc: "Watch users browse with a gaze dot. See confusion, hesitation, and missed CTAs in real time.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347c-.75.412-1.667-.13-1.667-.986V5.653z" />
      </svg>
    ),
  },
  {
    title: "Element-level insights",
    desc: '"#signup-btn: 450 fixations. #promo-banner: 0 fixations (missed)." Know exactly what\'s invisible.',
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    title: "Quality-verified data",
    desc: "Engagement score filters low-quality sessions before they reach your dashboard. Only verified data in.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
];

export default function HomePage() {
  return (
    <>
      {/* ─── Section 1: Hero ───────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-white dark:bg-zinc-950 py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-violet-500/10 blur-3xl" />
          <div className="absolute top-20 -left-20 h-[400px] w-[400px] rounded-full bg-teal-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
                See what users{" "}
                <span className="text-violet-600 dark:text-violet-400">actually</span>{" "}
                look at
              </h1>
              <p className="mt-6 text-xl leading-8 text-zinc-600 dark:text-zinc-400">
                Real people browse your site with our eye-tracking extension. You get heatmaps, replays, and attention insights. They earn rewards.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <Link href="/for-brands" className="rounded-full bg-violet-600 px-6 py-3 text-base font-semibold text-white hover:bg-violet-500 transition-all shadow-sm">
                  I&apos;m a brand
                </Link>
                <Link href="/for-you" className="rounded-full bg-teal-600 px-6 py-3 text-base font-semibold text-white hover:bg-teal-500 transition-all shadow-sm">
                  I want rewards
                </Link>
              </div>
            </div>

            {/* Heatmap mockup */}
            <div className="relative mx-auto w-full max-w-lg">
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 overflow-hidden shadow-2xl">
                <div className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-800 px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-green-400" />
                  <div className="ml-4 flex-1 rounded-md bg-white/60 dark:bg-zinc-700/60 px-3 py-1 text-xs text-zinc-500">
                    acme.com/checkout
                  </div>
                </div>
                <div className="relative h-64 bg-zinc-50 dark:bg-zinc-900">
                  <div className="absolute inset-0 p-4 space-y-3">
                    <div className="h-4 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
                    <div className="h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
                    <div className="mt-4 h-20 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
                    <div className="h-8 w-32 rounded bg-zinc-300 dark:bg-zinc-600" />
                  </div>
                  <div className="absolute top-8 left-12 h-20 w-28 rounded-full bg-red-500/30 blur-2xl" />
                  <div className="absolute top-16 left-24 h-12 w-20 rounded-full bg-red-400/40 blur-xl" />
                  <div className="absolute bottom-12 right-8 h-16 w-24 rounded-full bg-amber-400/30 blur-2xl" />
                  <div className="absolute bottom-8 left-8 h-10 w-16 rounded-full bg-green-400/20 blur-xl" />
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                    Live
                  </div>
                  <div className="absolute bottom-4 right-4 rounded-lg bg-white dark:bg-zinc-800 border border-amber-300 px-3 py-2 shadow-lg text-xs">
                    <span className="font-semibold text-amber-600">⚠ CTA missed</span>
                    <p className="text-zinc-500 mt-0.5">#checkout-btn: 0 fixations</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Section 2: How it works ─────────────────────────────── */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-16">
            How it works
          </h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-5 items-start">
            <div className="text-center md:col-span-1">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-bold text-lg">1</div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Brands set up tasks</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">"Browse our checkout" — attach a coupon as the reward.</p>
            </div>
            <div className="hidden md:flex items-center justify-center mt-6 text-zinc-300 dark:text-zinc-600">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
            <div className="text-center md:col-span-1">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold text-lg">2</div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Users browse + earn</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Pick a task, visit the site. The extension tracks gaze.</p>
            </div>
            <div className="hidden md:flex items-center justify-center mt-6 text-zinc-300 dark:text-zinc-600">
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
            <div className="text-center md:col-span-1">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 font-bold text-lg">3</div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">Everyone wins</h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Brand gets heatmaps. User gets a discount.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Section 3: Trust bar ────────────────────────────────── */}
      <section className="bg-white dark:bg-zinc-950 py-16 border-y border-zinc-100 dark:border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="flex flex-wrap justify-center gap-12 mb-12">
            {trustStats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">{stat.value}</div>
                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden">
            <div className="flex animate-scroll-left gap-8 w-max">
              {brandsLoop.map((brand, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-4 py-2 whitespace-nowrap">
                  <div className="h-6 w-6 rounded-full bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-500 dark:text-zinc-400">
                    {brand.name[0]}
                  </div>
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{brand.name}</span>
                  <span className="text-xs text-teal-600 dark:text-teal-400 font-semibold">{brand.reward}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Section 4: For brands ───────────────────────────────── */}
      <section id="for-brands" className="bg-white dark:bg-zinc-950 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="rounded-full bg-violet-100 dark:bg-violet-900/40 px-4 py-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
              For brands
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              Know what your users actually see
            </h2>
            <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
              Not clicks. Not cursor movement. Actual eye fixations from real people browsing your site.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {brandFeatureCards.map((card) => (
              <div key={card.title} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 hover:border-violet-300 dark:hover:border-violet-700 transition-all">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400">
                  {card.icon}
                </div>
                <h3 className="mt-4 font-semibold text-zinc-900 dark:text-zinc-50">{card.title}</h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{card.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/for-brands" className="rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white hover:bg-violet-500 transition-all">
              Start getting insights
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Section 5: For consumers ────────────────────────────── */}
      <section id="for-you" className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="rounded-full bg-teal-100 dark:bg-teal-900/40 px-4 py-1.5 text-sm font-semibold text-teal-700 dark:text-teal-300">
              For you
            </span>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
              Browse brands you love. Get discounts for looking.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3 mb-12">
            {[
              { step: "1", title: "Browse brands", desc: "Pick a brand task from the extension. Nike, Swiggy, Zomato — brands you already use." },
              { step: "2", title: "Complete tasks", desc: "Visit the pages in the task. Browse naturally — no scripts, no instructions beyond 'explore'." },
              { step: "3", title: "Earn rewards", desc: "Task complete? Coupon drops straight into your wallet. Redeem any time." },
            ].map((card) => (
              <div key={card.step} className="rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 font-bold text-lg mb-4">
                  {card.step}
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{card.title}</h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{card.desc}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-6 max-w-2xl mx-auto">
            <div className="flex items-start gap-4">
              <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900 text-teal-600 dark:text-teal-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-teal-900 dark:text-teal-100">Your privacy, protected</h4>
                <p className="mt-1 text-sm text-teal-800 dark:text-teal-200">
                  We track where your eyes look — not what you type. No passwords, no keystrokes, no photos. You control when tracking happens.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-10 text-center">
            <Link href="/for-you" className="rounded-full bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-500 transition-all">
              Install extension + start earning
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Section 6: Comparison table ─────────────────────────── */}
      <ComparisonTable
        heading="LessMissed vs traditional tools"
        competitors={["Hotjar / Clarity", "LessMissed"]}
        rows={comparisonRows}
      />

      {/* ─── Section 7: Featured brands ──────────────────────────── */}
      <section className="bg-white dark:bg-zinc-950 py-16 border-y border-zinc-100 dark:border-zinc-900">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <p className="text-center text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-8 uppercase tracking-wide">
            These brands are offering rewards right now
          </p>
          <div className="overflow-hidden">
            <div className="flex animate-scroll-left gap-6 w-max">
              {brandsLoop.map((brand, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-5 py-3 whitespace-nowrap shadow-sm">
                  <div className="h-8 w-8 rounded-full bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-sm font-bold text-zinc-600 dark:text-zinc-300">
                    {brand.name[0]}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{brand.name}</div>
                    <div className="text-xs text-teal-600 dark:text-teal-400">{brand.reward}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Section 8: Pricing teaser ───────────────────────────── */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400">
              Start free. Upgrade when you need more data.
            </p>
          </div>
          <PricingCards variant="teaser" />
        </div>
      </section>

      {/* ─── Section 9: Final CTA ────────────────────────────────── */}
      <FinalCTA
        heading="Stop guessing where users look."
        subheading="Get real gaze data from real people — and rewards for everyone involved."
        variant="dual"
      />
    </>
  );
}
