import Link from "next/link";
import PricingCards from "../../components/sections/PricingCards";
import FAQSection from "../../components/sections/FAQSection";
import FinalCTA from "../../components/sections/FinalCTA";

const brandFAQ = [
  {
    q: "How accurate is the eye-tracking data?",
    a: "WebGazer.js provides approximately ±100px accuracy after a 5-point calibration. This is sufficient for element-level heatmaps and fixation counts, though not medical-grade precision. Our engagement score further filters sessions where calibration quality was poor.",
  },
  {
    q: "Is this GDPR compliant?",
    a: "Yes. We collect only gaze coordinates — no photos, no video, no face data. Consumers give explicit consent before any tracking begins. All data is anonymized before reaching your dashboard. We never share consumer identity with brands.",
  },
  {
    q: "How do you prevent gaming / fake sessions?",
    a: "Our engagement score (0-100) measures 5 signals: fixation diversity, saccade naturalness, scroll-gaze correlation, page coverage, and interaction signals. Sessions scoring below 60 are excluded from your dashboard. Consumers who fake it still get excluded without punishment.",
  },
  {
    q: "Can I do A/B testing with LessMissed?",
    a: "Not natively in the current version, but you can create two separate tasks — one for each page variant — and compare the resulting heatmaps side by side. Native A/B support is on our roadmap.",
  },
  {
    q: "How long does it take to get data?",
    a: "As soon as consumers complete tasks for your project. On the Starter plan with 3 tasks/month, you could see first sessions within hours if your task reward is attractive. Growth plans with higher session caps fill faster.",
  },
];

const featureDeepDives = [
  {
    title: "Gaze heatmaps",
    desc: "A thermal map of where real users' eyes actually landed on your page. Red zones = high fixation. Green zones = seen but not engaged. Nothing = completely missed. Every pixel has a data story.",
    visual: "heatmap",
    textLeft: true,
  },
  {
    title: "Session replays with gaze dot",
    desc: "Watch back a full browsing session with a red dot showing exactly where the user looked at every moment. See confusion (erratic scanning), hesitation (long pauses before a CTA), and missed elements — as they happen.",
    visual: "replay",
    textLeft: false,
  },
  {
    title: "Missed elements detection",
    desc: "Your #promo-banner got 0 fixations across 200 sessions. Your #checkout-cta was looked at by only 12% of users. Element-level attention data tells you exactly which parts of your UI are invisible — and which ones drive action.",
    visual: "elements",
    textLeft: true,
  },
  {
    title: "Quality-verified data only",
    desc: "Every session is scored 0-100 using 5 behavioral signals. Sessions with fake or low-quality data are silently excluded. What reaches your dashboard is verified engagement from real users who actually browsed your site.",
    visual: "quality",
    textLeft: false,
  },
];

function FeatureVisual({ type }) {
  if (type === "heatmap") {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
        <div className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-800 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
          <span className="ml-3 text-xs text-zinc-500">acme.com/pricing</span>
        </div>
        <div className="relative h-52 p-4">
          <div className="space-y-2">
            <div className="h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-3 h-16 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="flex gap-2">
              <div className="h-7 w-20 rounded bg-zinc-300 dark:bg-zinc-600" />
              <div className="h-7 w-20 rounded bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </div>
          <div className="absolute top-4 left-8 h-16 w-24 rounded-full bg-red-500/35 blur-2xl" />
          <div className="absolute top-8 left-16 h-10 w-16 rounded-full bg-red-400/45 blur-xl" />
          <div className="absolute top-10 right-10 h-12 w-20 rounded-full bg-amber-400/25 blur-2xl" />
          <div className="absolute bottom-6 left-4 h-8 w-14 rounded-full bg-green-400/20 blur-xl" />
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-zinc-900/80 px-2 py-1 text-xs text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Gaze heatmap
          </div>
        </div>
      </div>
    );
  }
  if (type === "replay") {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Session replay — session_3f8a2</span>
          <span className="rounded-full bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 font-medium">Confused</span>
        </div>
        <div className="relative h-52 bg-zinc-900">
          <div className="absolute inset-0 p-4 space-y-2">
            <div className="h-3 w-3/4 rounded bg-zinc-700" />
            <div className="h-3 w-1/2 rounded bg-zinc-700" />
            <div className="mt-3 h-16 w-full rounded bg-zinc-700" />
            <div className="h-7 w-24 rounded bg-zinc-600" />
          </div>
          {/* Gaze dot */}
          <div className="absolute top-12 left-1/3 h-6 w-6 rounded-full bg-red-500/70 border-2 border-red-400 blur-[1px]" />
          {/* Scan path lines */}
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <polyline points="80,48 120,60 100,80 140,72 90,90" fill="none" stroke="rgba(239,68,68,0.3)" strokeWidth="1.5" />
          </svg>
        </div>
        <div className="flex items-center gap-4 border-t border-zinc-800 px-4 py-3">
          <button className="h-6 w-6 rounded-full bg-zinc-700 flex items-center justify-center">
            <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <div className="flex-1 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-violet-500" />
          </div>
          <span className="text-xs text-zinc-500">0:24 / 1:12</span>
        </div>
      </div>
    );
  }
  if (type === "elements") {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="border-b border-zinc-100 dark:border-zinc-800 px-4 py-3">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Element attention</span>
          <span className="ml-2 text-xs text-zinc-500">acme.com/checkout · 312 sessions</span>
        </div>
        <div className="p-4 space-y-3">
          {[
            { name: "#hero-headline", fixations: 1240, pct: 95, color: "bg-violet-500" },
            { name: "#product-image", fixations: 980, pct: 75, color: "bg-violet-400" },
            { name: "#price-tag", fixations: 720, pct: 55, color: "bg-amber-400" },
            { name: "#add-to-cart", fixations: 310, pct: 24, color: "bg-orange-400" },
            { name: "#promo-banner", fixations: 0, pct: 0, color: "bg-red-500", missed: true },
          ].map((el) => (
            <div key={el.name} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${el.missed ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900" : ""}`}>
              <span className={`text-xs font-mono ${el.missed ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>{el.name}</span>
              <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div className={`h-full rounded-full ${el.color}`} style={{ width: `${el.pct}%` }} />
              </div>
              {el.missed ? (
                <span className="text-xs font-semibold text-red-500">MISSED</span>
              ) : (
                <span className="text-xs text-zinc-500 dark:text-zinc-400 w-16 text-right">{el.fixations.toLocaleString()}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  // quality
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="border-b border-zinc-100 dark:border-zinc-800 px-4 py-3">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Data quality</span>
        <span className="ml-2 text-xs text-zinc-500">last 7 days</span>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-700 dark:text-zinc-300">Sessions passed quality check</span>
          <span className="font-bold text-teal-600 text-lg">87%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full w-[87%] rounded-full bg-teal-500" />
        </div>
        {[
          { signal: "Fixation diversity", score: 28, max: 30 },
          { signal: "Saccade naturalness", score: 21, max: 25 },
          { signal: "Scroll-gaze correlation", score: 18, max: 20 },
          { signal: "Page coverage", score: 13, max: 15 },
        ].map((s) => (
          <div key={s.signal} className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 w-44 shrink-0">{s.signal}</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-violet-500" style={{ width: `${(s.score / s.max) * 100}%` }} />
            </div>
            <span className="text-xs text-zinc-500 w-10 text-right">{s.score}/{s.max}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ForBrandsPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white dark:bg-zinc-950 py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-violet-500/10 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <span className="rounded-full bg-violet-100 dark:bg-violet-900/40 px-4 py-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
            For brands
          </span>
          <h1 className="mt-6 text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
            Know exactly where users look — and what they miss
          </h1>
          <p className="mt-6 text-xl leading-8 text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            Real consumers browse your site with our eye-tracking extension. You get gaze heatmaps, session replays, and element-level attention data.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/signup" className="rounded-full bg-violet-600 px-6 py-3 text-base font-semibold text-white hover:bg-violet-500 transition-all">
              Start free — 3 tasks/mo
            </Link>
            <Link href="/pricing" className="rounded-full border border-zinc-300 dark:border-zinc-700 px-6 py-3 text-base font-semibold text-zinc-700 dark:text-zinc-300 hover:border-violet-500 hover:text-violet-600 dark:hover:text-violet-400 transition-all">
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-sm text-zinc-400">No credit card required</p>
        </div>
      </section>

      {/* Dashboard preview */}
      <section className="bg-zinc-950 py-20">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <p className="text-center text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-10">
            Your insights dashboard
          </p>
          <div className="rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 bg-zinc-800 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-500" />
              <span className="h-3 w-3 rounded-full bg-amber-500" />
              <span className="h-3 w-3 rounded-full bg-green-500" />
              <div className="ml-4 flex-1 max-w-xs rounded-md bg-zinc-700 px-3 py-1 text-xs text-zinc-400">
                app.lessmissed.com/dashboard
              </div>
            </div>
            {/* Dashboard layout */}
            <div className="flex h-96 bg-zinc-900">
              {/* Sidebar */}
              <div className="w-48 shrink-0 border-r border-zinc-800 p-4 space-y-1">
                <div className="flex items-center gap-2 mb-6">
                  <div className="h-6 w-6 rounded-full bg-violet-600 flex items-center justify-center text-xs text-white font-bold">L</div>
                  <span className="text-sm font-semibold text-zinc-200">LessMissed</span>
                </div>
                {["Projects", "Heatmaps", "Replays", "Elements", "Analytics"].map((item, i) => (
                  <div key={item} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${i === 0 ? "bg-violet-900/50 text-violet-300" : "text-zinc-500"}`}>
                    <div className="h-1.5 w-1.5 rounded-full bg-current" />
                    {item}
                  </div>
                ))}
              </div>
              {/* Main area */}
              <div className="flex-1 p-6 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-semibold text-zinc-200">acme.com / /checkout</span>
                  <span className="rounded-full bg-red-900/50 text-red-400 text-xs px-2 py-0.5 font-medium">Critical</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {/* Heatmap area */}
                  <div className="col-span-1 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
                    <div className="relative h-48">
                      <div className="absolute inset-0 p-3 space-y-2">
                        <div className="h-2 w-2/3 rounded bg-zinc-700" />
                        <div className="h-2 w-1/2 rounded bg-zinc-700" />
                        <div className="mt-2 h-12 w-full rounded bg-zinc-700" />
                        <div className="h-5 w-20 rounded bg-zinc-600" />
                      </div>
                      <div className="absolute top-4 left-6 h-14 w-20 rounded-full bg-red-500/40 blur-2xl" />
                      <div className="absolute bottom-8 right-6 h-10 w-14 rounded-full bg-amber-400/30 blur-xl" />
                    </div>
                  </div>
                  {/* Element panel */}
                  <div className="col-span-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3 space-y-2">
                    <span className="text-xs font-medium text-zinc-400">Element attention</span>
                    {["#headline", "#price", "#add-to-cart", "#promo"].map((el, i) => (
                      <div key={el} className={`flex items-center gap-2 rounded px-2 py-1 ${i === 3 ? "bg-red-950/50 border border-red-900" : ""}`}>
                        <span className="text-xs font-mono text-zinc-400 w-24 truncate">{el}</span>
                        <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500" style={{ width: `${[90, 65, 30, 0][i]}%` }} />
                        </div>
                        {i === 3 && <span className="text-xs text-red-400">MISSED</span>}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Annotation */}
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2">
                  <span className="text-amber-400 text-sm">⚠</span>
                  <p className="text-xs text-amber-200">
                    <span className="font-semibold">Insight:</span> #checkout-btn received 0 fixations in 40% of sessions. CTA is being missed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature deep dives */}
      <section className="bg-white dark:bg-zinc-950 py-24">
        <div className="mx-auto max-w-6xl px-6 lg:px-8 space-y-24">
          {featureDeepDives.map((feature) => (
            <div key={feature.title} className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <div className={feature.textLeft ? "" : "lg:order-last"}>
                <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {feature.title}
                </h2>
                <p className="mt-4 text-lg leading-8 text-zinc-600 dark:text-zinc-400">
                  {feature.desc}
                </p>
              </div>
              <div className={feature.textLeft ? "" : "lg:order-first"}>
                <FeatureVisual type={feature.visual} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Reward model explainer */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              How the reward model works for you
            </h2>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
              You don&apos;t recruit testers. We bring you real consumers who are motivated to explore.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              { n: "1", title: "You create tasks", desc: "Define the pages to track. Write a task description like \"Explore our new collection\"." },
              { n: "2", title: "Attach a coupon", desc: "Add a discount code as the reward. 20% off, ₹100 off, free delivery — you decide." },
              { n: "3", title: "Real users browse", desc: "Consumers in our network pick up your task. They browse naturally — motivated by the reward." },
              { n: "4", title: "You get gaze data", desc: "Sessions flow into your dashboard as heatmaps, replays, and element insights." },
            ].map((step) => (
              <div key={step.n} className="rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-6 text-center">
                <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-bold">
                  {step.n}
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm">{step.title}</h3>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Case study */}
      <section className="bg-white dark:bg-zinc-950 py-24">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="bg-violet-600 px-6 py-4">
              <span className="text-sm font-semibold text-violet-100 uppercase tracking-wide">Sample result</span>
            </div>
            <div className="p-8">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                "An e-commerce brand discovered their checkout CTA was missed by 40% of users."
              </h2>
              <p className="mt-4 text-zinc-600 dark:text-zinc-400">
                After analyzing 312 sessions, the heatmap showed the primary &quot;Add to cart&quot; button received almost no fixations despite being above the fold. The button was the same color as the background — causing it to blend in. After a high-contrast redesign, CTR increased 34%.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-6">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Before</p>
                  <div className="relative h-32 bg-zinc-50 dark:bg-zinc-900 rounded-lg overflow-hidden">
                    <div className="absolute inset-0 p-3 space-y-2">
                      <div className="h-2 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="h-2 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="mt-2 h-8 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="h-5 w-20 rounded bg-zinc-200 dark:bg-zinc-600" />
                    </div>
                    {/* Heat blobs concentrated NOT on the button */}
                    <div className="absolute top-2 left-4 h-12 w-20 rounded-full bg-red-500/30 blur-xl" />
                  </div>
                  <p className="mt-2 text-xs text-red-500 font-medium">CTA missed by 40%</p>
                </div>
                <div className="rounded-xl border border-teal-200 dark:border-teal-800 p-4">
                  <p className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-3">After redesign</p>
                  <div className="relative h-32 bg-zinc-50 dark:bg-zinc-900 rounded-lg overflow-hidden">
                    <div className="absolute inset-0 p-3 space-y-2">
                      <div className="h-2 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="h-2 w-1/2 rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="mt-2 h-8 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
                      <div className="h-5 w-20 rounded bg-violet-400" />
                    </div>
                    {/* Heat blobs on the button */}
                    <div className="absolute bottom-8 left-4 h-12 w-20 rounded-full bg-red-500/40 blur-xl" />
                    <div className="absolute bottom-9 left-6 h-8 w-14 rounded-full bg-red-400/50 blur-lg" />
                  </div>
                  <p className="mt-2 text-xs text-teal-600 font-medium">+34% CTR after fix</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Pricing
            </h2>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400">Start free. No credit card required.</p>
          </div>
          <PricingCards variant="compact" />
        </div>
      </section>

      <FAQSection items={brandFAQ} heading="Brand FAQ" />

      <FinalCTA
        heading="See what your users actually see."
        subheading="Create your free account. Set up your first project in under 5 minutes."
        variant="brand"
      />
    </>
  );
}
