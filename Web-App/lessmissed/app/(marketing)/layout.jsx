import Header from "../components/Header";
import Footer from "../components/Footer";

export default function MarketingLayout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      <Header />
      <main className="flex-grow pt-16">{children}</main>
      <Footer />
    </div>
  );
}
