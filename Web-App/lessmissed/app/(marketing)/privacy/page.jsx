import Link from "next/link";

const sections = [
  {
    id: "what-we-collect",
    title: "What we collect",
    content: (
      <>
        <p>When you use the LessMissed Chrome extension during an active task session, we collect:</p>
        <ul>
          <li>Eye gaze coordinates (x, y pixel positions on the page)</li>
          <li>Scroll position and scroll depth during the session</li>
          <li>Click events (position only — not content or form fields)</li>
          <li>Page URLs visited during active task sessions</li>
          <li>Anonymous session ID (generated per session, not linked to identity)</li>
          <li>Timestamps of gaze events and page visits</li>
        </ul>

        <div className="not-prose my-6 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-5">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 mb-3">We explicitly do NOT collect:</p>
          <ul className="space-y-2">
            {[
              "Photos or video of your face",
              "Your facial features or biometric data",
              "Keystrokes or anything you type",
              "Form input or passwords",
              "Browsing history outside of active task sessions",
              "Your microphone or audio",
              "Any data from pages outside the task",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                <svg className="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p>The camera feed from WebGazer.js is processed entirely on your device. Only the resulting (x,y) gaze coordinate — not any image — is transmitted to our servers.</p>
      </>
    ),
  },
  {
    id: "when-we-collect",
    title: "When we collect",
    content: (
      <>
        <p>Data collection happens <strong>only during active task sessions</strong> that you explicitly start.</p>
        <p>The sequence is:</p>
        <ol>
          <li>You open the LessMissed extension popup</li>
          <li>You click "Start task" on a specific brand task</li>
          <li>The extension requests camera access (one-time browser prompt)</li>
          <li>Tracking begins <strong>after you grant camera access and the task starts</strong></li>
          <li>Tracking ends when you click "Stop task", the task completes, or you close the tab</li>
        </ol>
        <p>The extension does not run in the background. It does not track any browsing outside of active sessions. Camera access is released when the session ends.</p>
      </>
    ),
  },
  {
    id: "who-sees-data",
    title: "Who sees the data",
    content: (
      <>
        <p>Brands (clients) see <strong>aggregate, anonymized data only</strong>:</p>
        <ul>
          <li>Heatmaps showing gaze density across their pages</li>
          <li>Session replay animations (gaze dot on a page recording)</li>
          <li>Element-level fixation counts and attention rankings</li>
          <li>Confusion zones (areas of hesitation or re-scanning)</li>
        </ul>
        <p><strong>Brands never see</strong>: your name, email address, any personally identifiable information, or anything from sessions outside their own tasks.</p>
        <p>LessMissed staff may access session data for quality assurance, fraud prevention, and product improvement purposes.</p>
        <p>We do not sell, rent, or share your data with third parties for advertising or marketing.</p>
      </>
    ),
  },
  {
    id: "opt-out",
    title: "How to opt out or delete your data",
    content: (
      <>
        <p>You can stop data collection at any time by:</p>
        <ul>
          <li><strong>Pausing a task</strong>: Click "Pause" in the extension popup. Camera and tracking stop immediately.</li>
          <li><strong>Stopping a task</strong>: Click "Stop task". Session ends. Camera turns off.</li>
          <li><strong>Uninstalling the extension</strong>: Removes the extension from your browser. No further data is collected.</li>
          <li><strong>Deleting your account</strong>: Go to Profile → Settings → Delete account. All your data is purged from our servers within 30 days.</li>
        </ul>
        <p>To request data deletion by email: <a href="mailto:privacy@lessmissed.com" className="text-violet-600 dark:text-violet-400 hover:underline">privacy@lessmissed.com</a></p>
      </>
    ),
  },
  {
    id: "storage",
    title: "Data storage and security",
    content: (
      <>
        <p>Gaze session data is stored in MongoDB Atlas (encrypted at rest, AES-256). All data in transit uses TLS 1.3.</p>
        <p>Data retention periods by plan:</p>
        <ul>
          <li><strong>Starter</strong>: 7 days</li>
          <li><strong>Growth</strong>: 90 days</li>
          <li><strong>Enterprise</strong>: Unlimited (configurable)</li>
        </ul>
        <p>Consumer account data (email, reward history) is retained as long as the account is active. Upon account deletion, all associated session data is purged within 30 days.</p>
        <p>We use industry-standard security practices including access controls, audit logging, and regular security reviews.</p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    content: (
      <>
        <p>We use the following third-party services to operate LessMissed:</p>
        <ul>
          <li><strong>MongoDB Atlas</strong> — Database storage (encrypted)</li>
          <li><strong>Vercel</strong> — Web hosting for lessmissed.com</li>
          <li><strong>Google OAuth</strong> — Optional sign-in (if you use "Sign in with Google")</li>
        </ul>
        <p>We do not use advertising networks, tracking pixels, or third-party analytics tools that share your data with advertisers.</p>
        <p><strong>We do not sell data to third parties.</strong></p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="bg-white dark:bg-zinc-950 min-h-screen">
      <div className="mx-auto max-w-6xl px-6 lg:px-8 py-24">
        {/* Header */}
        <div className="mb-12 max-w-3xl">
          <span className="rounded-full bg-violet-100 dark:bg-violet-900/40 px-4 py-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
            Legal
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Privacy Policy
          </h1>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            Last updated: March 2026
          </p>
          <p className="mt-4 text-zinc-600 dark:text-zinc-400">
            LessMissed (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is committed to protecting your privacy. This policy describes what data we collect, how we use it, and your rights.
          </p>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            This policy complies with India&apos;s Digital Personal Data Protection (DPDP) Act 2023 and the requirements of the Chrome Web Store developer programme.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-4">
          {/* Sticky sidebar — jump links */}
          <aside className="hidden lg:block lg:col-span-1">
            <nav className="sticky top-24 space-y-1">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
                Sections
              </p>
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block rounded-lg px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                >
                  {section.title}
                </a>
              ))}
              <div className="pt-4 mt-4 border-t border-zinc-100 dark:border-zinc-800">
                <a
                  href="mailto:privacy@lessmissed.com"
                  className="block rounded-lg px-3 py-2 text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
                >
                  Contact privacy team →
                </a>
              </div>
            </nav>
          </aside>

          {/* Main content */}
          <main className="lg:col-span-3 space-y-16">
            {sections.map((section) => (
              <section key={section.id} id={section.id}>
                <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-6">
                  {section.title}
                </h2>
                <div className="prose-custom space-y-4 text-zinc-700 dark:text-zinc-300 leading-7">
                  {section.content}
                </div>
              </section>
            ))}

            {/* Contact */}
            <section>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-6">
                Contact us
              </h2>
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                <p>For privacy questions, data deletion requests, or complaints:</p>
                <p>
                  Email:{" "}
                  <a href="mailto:privacy@lessmissed.com" className="text-violet-600 dark:text-violet-400 hover:underline">
                    privacy@lessmissed.com
                  </a>
                </p>
                <p>We aim to respond within 3 business days.</p>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
