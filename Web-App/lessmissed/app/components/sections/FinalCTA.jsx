import Link from "next/link";

export default function FinalCTA({
  heading = "Stop guessing where users look.",
  subheading = "Get real gaze data from real people — and rewards for everyone involved.",
  variant = "dual",
}) {
  return (
    <section className="bg-zinc-900 py-24">
      <div className="mx-auto max-w-3xl px-6 lg:px-8 text-center">
        <h2 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {heading}
        </h2>
        <p className="mt-6 text-lg leading-8 text-zinc-400">
          {subheading}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          {(variant === "dual" || variant === "brand") && (
            <Link
              href="/for-brands"
              className="rounded-full bg-violet-600 px-6 py-3 text-base font-semibold text-white hover:bg-violet-500 transition-all"
            >
              I&apos;m a brand
            </Link>
          )}
          {(variant === "dual" || variant === "consumer") && (
            <Link
              href="/for-you"
              className="rounded-full bg-teal-600 px-6 py-3 text-base font-semibold text-white hover:bg-teal-500 transition-all"
            >
              I want rewards
            </Link>
          )}
          {variant === "brand" && (
            <Link
              href="/signup"
              className="rounded-full border border-zinc-600 px-6 py-3 text-base font-semibold text-zinc-300 hover:border-violet-400 hover:text-violet-300 transition-all"
            >
              Create free account
            </Link>
          )}
          {variant === "consumer" && (
            <Link
              href="#"
              className="rounded-full border border-zinc-600 px-6 py-3 text-base font-semibold text-zinc-300 hover:border-teal-400 hover:text-teal-300 transition-all"
            >
              Install extension — free
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
