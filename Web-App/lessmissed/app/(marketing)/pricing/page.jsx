import Link from "next/link";
import PricingCards from "../../components/sections/PricingCards";
import ComparisonTable from "../../components/sections/ComparisonTable";
import FAQSection from "../../components/sections/FAQSection";
import FinalCTA from "../../components/sections/FinalCTA";

const featureRows = [
  { feature: "Tasks per month", competitors: ["3", "Unlimited", "Unlimited"] },
  { feature: "Sessions per month", competitors: ["50", "500", "Unlimited"] },
  { feature: "Projects", competitors: ["1", "5", "Unlimited"] },
  { feature: "Gaze heatmaps", competitors: ["Basic", "Full", "Full"] },
  { feature: "Session replays", competitors: [false, true, true] },
  { feature: "Element-level insights", competitors: [false, true, true] },
  { feature: "Data retention", competitors: ["7 days", "90 days", "Unlimited"] },
  { feature: "Team seats", competitors: ["1", "3", "Custom"] },
  { feature: "API access", competitors: [false, false, true] },
  { feature: "SSO / SAML", competitors: [false, false, true] },
  { feature: "Priority support", competitors: [false, true, true] },
  { feature: "Dedicated CSM", competitors: [false, false, true] },
];

const pricingFAQ = [
  {
    q: "Can I cancel at any time?",
    a: "Yes. Cancel any time from your billing settings. You keep access until the end of your billing period. No cancellation fees.",
  },
  {
    q: "What counts as a session?",
    a: "A session is one consumer completing your task — visiting all the required pages and passing our engagement quality check. Low-quality sessions that fail the check don't count against your quota.",
  },
  {
    q: "Do unused sessions roll over?",
    a: "No. Sessions reset monthly. Unused sessions don't roll over to the next billing period.",
  },
  {
    q: "Do I pay for the coupons separately?",
    a: "Yes — but only when they're redeemed. You provide the coupon codes and set the redemption rules. LessMissed does not take a cut of coupon value. Our revenue is subscription-only.",
  },
  {
    q: "Can I start with Starter and upgrade later?",
    a: "Yes. You can upgrade at any time. When you upgrade mid-cycle, you're charged a prorated amount and immediately get access to the new limits.",
  },
];

export default function PricingPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-white dark:bg-zinc-950 py-24 sm:py-32">
        <div className="mx-auto max-w-3xl px-6 lg:px-8 text-center">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
            Simple pricing.{" "}
            <span className="text-violet-600 dark:text-violet-400">Start free,</span>{" "}
            scale when you need to.
          </h1>
          <p className="mt-6 text-xl leading-8 text-zinc-600 dark:text-zinc-400">
            No credit card required on the Starter plan. Upgrade only when you need more data.
          </p>
        </div>
      </section>

      {/* Plan cards */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-16 pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <PricingCards variant="full" />
        </div>
      </section>

      {/* Feature comparison table */}
      <ComparisonTable
        heading="Feature comparison"
        competitors={["Starter", "Growth", "Enterprise"]}
        rows={featureRows}
      />

      {/* Coupon economics explainer */}
      <section className="bg-white dark:bg-zinc-950 py-24">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              How coupon costs work
            </h2>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
              You provide the coupons. We provide the users. LessMissed takes no cut of coupon value.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                title: "You provide the coupons",
                desc: "Create any discount type — percentage off, fixed amount, free delivery, or custom text. You set the value, not us.",
                icon: "🎟️",
              },
              {
                title: "We provide the users",
                desc: "Real consumers from our network complete your tasks. You only pay the LessMissed subscription — not per user.",
                icon: "👥",
              },
              {
                title: "You control the rules",
                desc: "Set a redemption cap (first 500 only), expiry date, minimum order value, or one-per-user restriction. Full control.",
                icon: "⚙️",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 text-center">
                <div className="text-3xl mb-4">{item.icon}</div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 mb-2">{item.title}</h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-6 text-center">
            <p className="text-sm text-violet-800 dark:text-violet-200">
              <span className="font-semibold">Example:</span> You create a "20% off" coupon with a cap of 100 redemptions. 100 consumers complete tasks and earn the coupon. You receive 100 verified gaze sessions. Coupon cost = 100 × your margin on 20% off. LessMissed charge = your monthly subscription only.
            </p>
          </div>
        </div>
      </section>

      <FAQSection items={pricingFAQ} heading="Pricing FAQ" />

      <FinalCTA
        heading="Start free — upgrade when you&apos;re ready."
        subheading="No commitment. Cancel any time. First insights in minutes."
        variant="brand"
      />
    </>
  );
}
