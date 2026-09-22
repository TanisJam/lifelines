import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, Crimson_Pro } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import { GlobalFooter, GlobalHeader } from "@/components/global-header";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { resolveLang } from "@/i18n/resolve-lang";
import "../globals.css";

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

/** Decision 059: both locales are known statically, so every `app/[lang]/**` route is pre-rendered for each (the internationalization guide's own `generateStaticParams` pattern). */
export async function generateStaticParams(): Promise<{ lang: Locale }[]> {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const dict = getDictionary(resolveLang(lang));
  return { title: dict.meta.title, description: dict.meta.description };
}

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

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = resolveLang(lang);
  return (
    <html lang={locale} className={`${cormorant.variable} ${crimson.variable} ${cinzel.variable} h-full`}>
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
