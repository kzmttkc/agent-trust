import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/docs/api`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/accuracy`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: "daily", priority: 0.7 },
    // 2026-08-13 UX監査R1 [C5]: /payee は LP の主 CTA（"Verify a payee now"）の
    // 行き先で、鍵もアカウントも要らない唯一の公開デモなのに sitemap に
    // 載っていなかった。個々の /payee/:address は無限に生成できるので
    // 列挙しない（robots は許可済み・各頁は自己参照 canonical を持つ）が、
    // 入口だけは必ず載せる。
    { url: `${SITE_URL}/payee`, changeFrequency: "monthly", priority: 0.9 },
    // [C8] 訂正ログ。件数が0でも索引に載せる — 「公開している」ことが
    // この頁の内容そのものなので。
    { url: `${SITE_URL}/corrections`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${SITE_URL}/faq`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/signup`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/legal/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/legal/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/legal/notice`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const postRoutes: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...postRoutes];
}
