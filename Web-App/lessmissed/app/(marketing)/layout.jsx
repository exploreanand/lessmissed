import Header from "../components/Header";
import Footer from "../components/Footer";
import { getSessionUser } from "@/lib/auth/session";

export default async function MarketingLayout({ children }) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      <Header user={user} />
      <main className="flex-grow pt-16">{children}</main>
      <Footer />
    </div>
  );
}
