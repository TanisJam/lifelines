import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, Crimson_Pro } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import { GlobalFooter, GlobalHeader } from "@/components/global-header";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const crimson = Crimson_Pro({
  variable: "--font-crimson",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Lifelines — a chronicle simulator",
  description: "Simulate a small town's lives year by year, then rewrite one moment and watch the butterfly effect unfold.",
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("lifelines-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${crimson.variable} ${cinzel.variable} h-full`}>
      <body className="min-h-full flex flex-col pb-20 antialiased sm:pb-0">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <GlobalHeader />
        <main className="flex-1">{children}</main>
        <GlobalFooter />
      </body>
    </html>
  );
}
