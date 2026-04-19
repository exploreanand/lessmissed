"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

function buildBreadcrumbs(pathname) {
  const segments = pathname.replace("/dashboard", "").split("/").filter(Boolean);
  const crumbs = [{ label: "Dashboard", href: "/dashboard/projects" }];

  let path = "/dashboard";
  for (const seg of segments) {
    path += `/${seg}`;
    const label =
      seg === "projects" ? "Projects"
      : seg === "tasks" ? "Tasks"
      : seg === "coupons" ? "Coupons"
      : seg === "setup" ? "Setup"
      : seg === "new" ? "New"
      : seg === "pages" ? null
      : seg === "sessions" ? null
      : seg;
    if (label) crumbs.push({ label, href: path });
  }
  return crumbs;
}

export default function Topbar({ onMenuClick }) {
  const pathname = usePathname();
  const crumbs = buildBreadcrumbs(pathname);

  return (
    <div className="flex items-center justify-between h-14 px-4 lg:px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
      {/* Left: hamburger + breadcrumb */}
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm">
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">/</span>}
              {i === crumbs.length - 1 ? (
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{crumb.label}</span>
              ) : (
                <Link href={crumb.href} className="text-zinc-500 dark:text-zinc-400 hover:text-violet-600 dark:hover:text-violet-400">
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* Right: date range */}
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
          </svg>
          Last 30 days
        </span>
      </div>
    </div>
  );
}
