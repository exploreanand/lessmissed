import Link from "next/link";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-200 bg-white pt-16 pb-8 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">

          {/* Brand Column */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-6 w-6 text-violet-600 dark:text-violet-400"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                LessMissed
              </span>
            </Link>
            <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Built for UX teams and savvy shoppers.
            </p>
            <div className="mt-6 flex space-x-6">
              <SocialLink href="#" label="Twitter">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
                </svg>
              </SocialLink>
              <SocialLink href="#" label="GitHub">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </SocialLink>
            </div>
          </div>

          {/* Product Column */}
          <div className="mt-10 md:mt-0">
            <h3 className="text-sm font-semibold leading-6 text-zinc-900 dark:text-zinc-50">Product</h3>
            <ul role="list" className="mt-6 space-y-4">
              <FooterLink href="/for-brands">For brands</FooterLink>
              <FooterLink href="/for-you">For consumers</FooterLink>
              <FooterLink href="/pricing">Pricing</FooterLink>
              <FooterLink href="/docs">Docs</FooterLink>
            </ul>
          </div>

          {/* Resources Column */}
          <div className="mt-10 md:mt-0">
            <h3 className="text-sm font-semibold leading-6 text-zinc-900 dark:text-zinc-50">Resources</h3>
            <ul role="list" className="mt-6 space-y-4">
              <FooterLink href="#">Blog</FooterLink>
              <FooterLink href="#">Case studies</FooterLink>
              <FooterLink href="/docs">Documentation</FooterLink>
              <FooterLink href="#">Contact</FooterLink>
            </ul>
          </div>

          {/* Legal Column */}
          <div className="mt-10 md:mt-0">
            <h3 className="text-sm font-semibold leading-6 text-zinc-900 dark:text-zinc-50">Legal</h3>
            <ul role="list" className="mt-6 space-y-4">
              <FooterLink href="/privacy">Privacy Policy</FooterLink>
              <FooterLink href="#">Terms of Service</FooterLink>
              <FooterLink href="/privacy#retention">Data Retention</FooterLink>
            </ul>
          </div>
        </div>

        <div className="mt-16 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            &copy; {currentYear} LessMissed. All rights reserved. LessMissed — Real gaze data from real people.
          </p>
        </div>
      </div>
    </footer>
  );
}

function SocialLink({ href, children, label }) {
  return (
    <a href={href} className="text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300">
      <span className="sr-only">{label}</span>
      {children}
    </a>
  );
}

function FooterLink({ href, children }) {
  return (
    <li>
      <Link
        href={href}
        className="text-sm leading-6 text-zinc-600 hover:text-violet-600 dark:text-zinc-400 dark:hover:text-violet-400"
      >
        {children}
      </Link>
    </li>
  );
}
