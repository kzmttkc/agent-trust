import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { SiteChrome } from "@/components/site/SiteChrome";

// 2026-07-22 CTO実装: 全社日次反応レポート(daily_reaction_report.py)向けに
// 合流Plausibleサイト(sharoushi-agent.com)へ計装(未計装だった6サイトの1つ)。
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vouch — Trust layer for agent commerce",
  description: "ERC-8004 agent trust scores on Base for x402 API providers.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the per-request nonce (set by src/proxy.ts) opts this layout
  // out of static rendering, which nonce-based CSP requires: Next.js
  // automatically applies this same nonce to its own inline hydration
  // script, and a statically-cached page would otherwise ship a stale
  // nonce that no longer matches the fresh one in the response header.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {PLAUSIBLE_DOMAIN ? (
          <Script
            defer
            nonce={nonce}
            data-domain={PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
            strategy="afterInteractive"
          />
        ) : null}
      </head>
      <body className="min-h-full flex flex-col">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
