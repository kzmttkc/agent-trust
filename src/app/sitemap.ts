import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site-url";

// 静的頁の lastmod（2026-08-14）。`new Date()` を使うとデプロイのたびに全頁が
// 「今日更新」に化けて偽の鮮度信号になるので使わない。ここは公開面の最後の
// 実改訂日を手で持つ定数にし、公開面に実質的な変更を入れたときだけ上げる。
// 個々のブログ記事は post.updatedAt という本物の信号を各自持っている。
const SITE_REVISION = "2026-08-14";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: SITE_REVISION, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/docs/api`, lastModified: SITE_REVISION, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/accuracy`, lastModified: SITE_REVISION, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/leaderboard`, lastModified: SITE_REVISION, changeFrequency: "daily", priority: 0.7 },
    // 2026-08-13 UX監査R1 [C5]: /payee は LP の主 CTA（"Verify a payee now"）の
    // 行き先で、鍵もアカウントも要らない唯一の公開デモなのに sitemap に
    // 載っていなかった。個々の /payee/:address は無限に生成できるので
    // 列挙しない（robots は許可済み・各頁は自己参照 canonical を持つ）が、
    // 入口だけは必ず載せる。
    { url: `${SITE_URL}/payee`, lastModified: SITE_REVISION, changeFrequency: "monthly", priority: 0.9 },
    // [C8] 訂正ログ。件数が0でも索引に載せる — 「公開している」ことが
    // この頁の内容そのものなので。
    { url: `${SITE_URL}/corrections`, lastModified: SITE_REVISION, changeFrequency: "weekly", priority: 0.5 },
    // 2026-08-14: operator-log は公開頁（200）で robots も許可済みだが sitemap に
    // 抜けていた。corrections と同じ「公開していること自体が内容」の帳簿。
    { url: `${SITE_URL}/operator-log`, lastModified: SITE_REVISION, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/faq`, lastModified: SITE_REVISION, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/blog`, lastModified: SITE_REVISION, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/signup`, lastModified: SITE_REVISION, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/legal/terms`, lastModified: SITE_REVISION, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/legal/privacy`, lastModified: SITE_REVISION, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/legal/notice`, lastModified: SITE_REVISION, changeFrequency: "yearly", priority: 0.3 },
  ];

  const postRoutes: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...postRoutes];
}
