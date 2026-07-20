import type { MetadataRoute } from "next";

const SITE_URL = "https://agent-trust-tawny.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/blog", "/docs/", "/legal/", "/llms.txt", "/sitemap.xml"],
        disallow: ["/api/", "/dashboard/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
