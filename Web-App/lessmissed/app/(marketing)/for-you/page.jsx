import Link from "next/link";
import FAQSection from "../../components/sections/FAQSection";
import FinalCTA from "../../components/sections/FinalCTA";
import ExtensionDemo from "../../components/ExtensionDemo";

// TODO: Replace with API fetch from brand database (spec §4.3 Section 2)
const availableBrands = [
  { name: "Nike", initial: "N", reward: "20% off", task: "Explore the new Air Max collection", earned: 1204, isNew: true },
  { name: "Swiggy", initial: "S", reward: "₹100 off", task: "Browse 3 restaurant categories", earned: 3890, isNew: false },
  { name: "Zomato", initial: "Z", reward: "Free delivery ×3", task: "Check out trending restaurants near you", earned: 2100, isNew: true },
  { name: "Myntra", initial: "M", reward: "15% off", task: "Explore the summer collection", earned: 876, isNew: false },
  { name: "Nykaa", initial: "N", reward: "₹200 off", task: "Browse 2 skincare categories", earned: 640, isNew: true },
  { name: "Boat", initial: "B", reward: "12% off", task: "Explore earbuds and headphones", earned: 390, isNew: false },
];

const consumerFAQ = [
  {
    q: "Do I have to buy anything to earn the reward?",
    a: "No. You just browse. You never need to make a purchase. The coupon is yours to use whenever you want — or never. Completely your choice.",
  },
  {
    q: "Does it record my webcam or take photos?",
    a: "No photos, no video, no face data. The camera feed is processed entirely on your device by WebGazer.js. Only gaze coordinates (x, y positions) are sent to our servers — never images.",
  },
  {
    q: "How long does a task take?",
    a: "Most tasks take 3–8 minutes. You're browsing pages you'd visit anyway — there's no script to follow. Just explore naturally.",
  },
  {
    q: "Does it work on my phone?",
    a: "Currently, LessMissed is a Chrome desktop extension only. Mobile support is on our roadmap.",
  },
  {
    q: "Can I do multiple tasks in a day?",
    a: "Yes. Each brand has its own daily cap, but you can complete tasks from multiple brands in the same day. More browsing = more rewards.",
  },
  {
    q: "What happens if a task is full?",
    a: "Some tasks have a daily cap. If a task is full for the day, you'll see it greyed out with \"Come back tomorrow\". New tasks open at midnight.",
  },
];

const privacyCards = [
  {
    title: "We track eye direction only",
    desc: "No photos or video recorded. No face images stored. The camera feed never leaves your device — only (x,y) coordinates are sent.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: "You control everything",
    desc: "Tracking only starts when you click \"Start task\". Camera turns off the moment you stop or pause. Nothing runs in the background.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
    ),
  },
  {
    title: "Completely anonymous",
    desc: "Brands see aggregate heatmaps only. Your name, email, and identity are never shared with any brand.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    title: "Uninstall anytime",
    desc: "One click removes everything. Your data is deleted within 30 days of account deletion. No lock-in, no dark patterns.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    ),
  },
];

// TODO: Replace with real testimonial data
const testimonials = [
  { quote: "Got a ₹200 Nykaa coupon just for browsing for 6 minutes. Used it the same day.", name: "Priya M.", location: "Bangalore" },
  { quote: "It's literally free money for something I do anyway — browse brands online.", name: "Rahul K.", location: "Mumbai" },
  { quote: "The extension is super lightweight and I barely notice it's running.", name: "Anjali S.", location: "Delhi" },
];

export default function ForYouPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white dark:bg-zinc-950 py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-teal-500/10 blur-3xl" />
          <div className="absolute top-20 -left-20 h-[400px] w-[400px] rounded-full bg-violet-500/8 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8 text-center">
          <span className="rounded-full bg-teal-100 dark:bg-teal-900/40 px-4 py-1.5 text-sm font-semibold text-teal-700 dark:text-teal-300">
            For you
          </span>
          <h1 className="mt-6 text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
            Browse brands you love.{" "}
            <span className="text-teal-600 dark:text-teal-400">Get discounts for looking.</span>
          </h1>
          <p className="mt-6 text-xl leading-8 text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            Install our free Chrome extension. Complete browsing tasks on your favourite brands. Earn real coupons — no purchase required.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="#" className="rounded-full bg-teal-600 px-6 py-3 text-base font-semibold text-white hover:bg-teal-500 transition-all">
              Install extension — it&apos;s free
            </Link>
            <Link href="/signup" className="rounded-full border border-zinc-300 dark:border-zinc-700 px-6 py-3 text-base font-semibold text-zinc-700 dark:text-zinc-300 hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-400 transition-all">
              Create account first
            </Link>
          </div>
          <p className="mt-4 text-sm text-zinc-400">Chrome only · Takes 10 seconds</p>
        </div>
      </section>

      {/* Rewards preview */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-4">
            Brands offering rewards right now
          </h2>
          <p className="text-center text-zinc-500 dark:text-zinc-400 mb-12">
            {/* TODO: Replace with live count from API (spec §4.3 Section 2) */}
            Thousands of rewards earned this month.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {availableBrands.map((brand) => (
              <div key={brand.name} className="rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-5 hover:border-teal-300 dark:hover:border-teal-700 transition-all">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center font-bold text-zinc-500 dark:text-zinc-400">
                      {brand.initial}
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-900 dark:text-zinc-50">{brand.name}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{brand.earned.toLocaleString()} earned this</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-semibold px-2.5 py-1">
                      {brand.reward}
                    </span>
                    {brand.isNew && (
                      <span className="text-xs text-violet-500 font-medium">New today</span>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{brand.task}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-zinc-400">~5 min · 3 pages</span>
                  <Link href="/signup" className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:text-teal-500">
                    Start task →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white dark:bg-zinc-950 py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-16">
            How to start earning
          </h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
            {[
              { n: "1", title: "Install", desc: "Add the LessMissed extension from the Chrome Web Store. Takes 10 seconds." },
              { n: "2", title: "Pick a task", desc: "Open the extension popup. See available brand tasks with their rewards." },
              { n: "3", title: "Browse", desc: "Visit the brand pages. Browse naturally — the extension does the rest." },
              { n: "4", title: "Earn", desc: "Task complete? Your coupon appears in your wallet instantly." },
            ].map((step) => (
              <div key={step.n} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 font-bold text-lg">
                  {step.n}
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{step.title}</h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy & trust */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Your privacy is non-negotiable
            </h2>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
              We know you&apos;re trusting us with camera access. Here&apos;s exactly what we do — and don&apos;t do.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {privacyCards.map((card) => (
              <div key={card.title} className="rounded-2xl bg-white dark:bg-zinc-950 border border-teal-200 dark:border-teal-800 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 mb-4">
                  {card.icon}
                </div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{card.title}</h3>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{card.desc}</p>
              </div>
            ))}
          </div>
          <p className="text-center mt-8 text-sm text-zinc-500 dark:text-zinc-400">
            Read the full details in our{" "}
            <Link href="/privacy" className="text-teal-600 dark:text-teal-400 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-white dark:bg-zinc-950 py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-8">
          <div className="text-center mb-16">
            {/* TODO: Replace with live count from database (spec §4.3 Section 5) */}
            <p className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">12,400+</p>
            <p className="mt-2 text-zinc-500 dark:text-zinc-400">rewards earned this month</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {testimonials.map((t) => (
              <div key={t.name} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
                <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-7">&ldquo;{t.quote}&rdquo;</p>
                <div className="mt-4">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t.name}</p>
                  <p className="text-xs text-zinc-500">{t.location}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Extension popup demo */}
      <section className="bg-zinc-50 dark:bg-zinc-900 py-24">
        <div className="mx-auto max-w-4xl px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Try the flow — before you install
            </h2>
            <p className="mt-4 text-zinc-600 dark:text-zinc-400">
              This is an interactive mockup of the extension popup. See exactly what you&apos;ll experience.
            </p>
          </div>
          <ExtensionDemo />
        </div>
      </section>

      <FAQSection items={consumerFAQ} heading="Your questions answered" />

      <FinalCTA
        heading="Your next discount is 5 minutes away."
        subheading="Install the extension, pick a brand you love, and start earning real rewards."
        variant="consumer"
      />
    </>
  );
}
