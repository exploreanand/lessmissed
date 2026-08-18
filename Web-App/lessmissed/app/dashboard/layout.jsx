import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import DashboardShell from "./DashboardShell";

export default async function DashboardLayout({ children }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <DashboardShell>{children}</DashboardShell>;
}
