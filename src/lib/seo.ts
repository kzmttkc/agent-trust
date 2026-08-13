// Per-page metadata の共通ビルダ（2026-08-14 SEO/AEO/LLMO 是正）。
//
// WHY: ルート layout は openGraph / twitter を1度だけ定義しており、各ページは
// title / description だけを上書きしていた。Next.js は openGraph オブジェクトを
// ページ側で「置換」する（深いマージはしない）ため、ページが openGraph を
// 持たない限り og:title / og:url は layout の既定 —— つまり LP の長い表題と
// トップの URL —— のまま出る。実測（curl https://vet402.com/faq）でも全公開
// ページの og:title が LP のもの・og:url が https://vet402.com になっていた。
// X / Slack / 各回答エンジンが個々のページをすべて「トップページ」として
// 扱ってしまう状態だったので、経路（=このビルダ1本）で個別化する。
//
// og:image はここで images を書かない。src/app/opengraph-image.png の
// ファイル規約が全ルートに og:image を自動配線しており（実測で全ページに
// 載っている）、ここで images を書くとその自動配線を上書きしてしまう。
//
// og:title は接尾辞なしの素のページ名にする。ブランドは og:site_name = "vet402"
// が担う。既存の blog/[slug] も同じ流儀（<title> の "%s | vet402" と二重に
// ならないよう素のタイトルを OG に入れている）。
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/site-url";

type PageMetaInput = {
  /** 接尾辞 " | vet402" を含まない素のページ名。<title> は layout の template が付ける。 */
  title: string;
  description: string;
  /** 先頭スラッシュ付きの絶対パス（例 "/faq"）。ルートは "/"。 */
  path: string;
  /** OpenGraph の type。既定は "website"、記事は "article"。 */
  ogType?: "website" | "article";
};

// BreadcrumbList の JSON-LD を組む（2026-08-14 AEO）。回答エンジン・検索が
// ページの階層を把握しやすくなり、パンくずリッチリザルトの対象にもなる。
// items は Home を含めた順路（末尾が現在ページ）。position は 1 始まり。
export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.path === "/" ? SITE_URL : `${SITE_URL}${item.path}`,
    })),
  };
}

export function pageMetadata({
  title,
  description,
  path,
  ogType = "website",
}: PageMetaInput): Metadata {
  const url = path === "/" ? SITE_URL : `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: ogType,
      siteName: "vet402",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
