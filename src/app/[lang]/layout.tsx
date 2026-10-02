import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, EB_Garamond } from "next/font/google";
import type { ReactNode } from "react";
import { GlobalFooter, GlobalHeader } from "@/components/global-header";
import { locales, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/get-dictionary";
import { resolveLang } from "@/i18n/resolve-lang";
import "../globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const garamond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = resolveLang(lang);
  return (
    <html lang={locale} className={`${cormorant.variable} ${garamond.variable} ${cinzel.variable} h-full`}>
      <body className="min-h-full flex flex-col pb-20 antialiased sm:pb-0">
        <GlobalHeader />
        <main className="flex-1">{children}</main>
        <GlobalFooter />
      </body>
    </html>
  );
}
