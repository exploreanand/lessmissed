import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard/projects");

  return <LoginForm />;
}
