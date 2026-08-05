import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";

const SITE_URL = "https://agent-trust-tawny.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/docs/api`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/accuracy`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/leaderboard`, changeFrequency: "daily", priority: 0.7 },
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
