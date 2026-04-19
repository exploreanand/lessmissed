import Link from "next/link";

const variants = {
  brand: "bg-violet-600 hover:bg-violet-500 text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600",
  consumer: "bg-teal-600 hover:bg-teal-500 text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600",
  outline: "border border-zinc-300 hover:border-violet-500 text-zinc-700 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-violet-400 dark:hover:text-violet-400",
};

const sizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

export default function Button({ variant = "brand", size = "md", href, children, className = "", ...props }) {
  const base = "inline-flex items-center justify-center rounded-full font-semibold transition-all";
  const cls = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if (href) {
    return <Link href={href} className={cls} {...props}>{children}</Link>;
  }
  return <button className={cls} {...props}>{children}</button>;
}
