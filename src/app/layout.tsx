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

const SITE_URL = "https://agent-trust-tawny.vercel.app";
const SITE_TITLE = "Vouch — Trust layer for agent commerce";
const SITE_DESCRIPTION = "ERC-8004 agent trust scores on Base for x402 API providers.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  // GSC所有権確認用のmetaタグ。GOOGLE_SITE_VERIFICATION(Vercel env)が未設定なら
  // Next.jsは何も出力しない(非破壊)。GSCプロパティ追加時のトークンをVercel環境変数
  // に入れて再デプロイすれば <meta name="google-site-verification"> が出力され確認が
  // 通る。metaタグはCSP(nonce)の影響を受けない。2026-07-23 IndexNow横展開に合わせて配線。
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || "P4SSxlBKJYSC0NYhh7xeStZ4MPg8_TnMm2HNQfZhl28" },
  // 2026-07-24 growth-hacker: OGP/Twitterカードが未設定でX/Slack等での共有時に
  // タイトル・説明文すら出ない状態だったため追加。Verilotの先例(commit参照)に
  // ならいテキストのみ(og:image無し) — 未承認のAI生成テキスト入り画像は
  // 公開に出さない方針(feedback_no_ai_text_images_public)のため、ブランド画像
  // 承認が下りるまでは画像を追加しない。
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    type: "website",
    siteName: "Vouch",
  },
  twitter: {
    // summary_large_image: og画像(app/opengraph-image.tsx・コード描画の製品UI)を
    // 2026-08-05に追加したため、大判カードで表示させる。
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
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
