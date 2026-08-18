import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import SignupForm from "./SignupForm";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard/projects");

  return <SignupForm />;
}
