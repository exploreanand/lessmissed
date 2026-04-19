import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

export const metadata = {
  title: "LessMissed — See what users actually look at",
  description:
    "Real people browse your site with our eye-tracking extension. You get heatmaps, replays, and attention insights. They earn rewards.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
