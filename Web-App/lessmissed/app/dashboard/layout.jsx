import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import DashboardShell from "./DashboardShell";

export default async function DashboardLayout({ children }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Consumers have no projects and see no analytics — the dashboard is a
  // brand-only surface. Sending them home is nicer than a chain of empty
  // states or 404s from every ownership-scoped page.
  if (user.type === "consumer") redirect("/");

  return <DashboardShell>{children}</DashboardShell>;
}
