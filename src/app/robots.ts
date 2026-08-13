import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// AEO/LLMO: 回答エンジン・LLM のクローラを明示的に許可する（2026-08-14）。
// userAgent:"*" が既に全許可なので機能的には冗長だが、明示することで
// (1) 名指しで許可している意図が robots.txt を読む運用者・監査に伝わり、
// (2) 一部クローラが「自分の UA 名がある行」を優先評価する挙動に対して
// 曖昧さを残さない。学習用途を含め全面的に歓迎する（この製品は機械可読の
// 誠実さを売りにしており、機械に読まれることが目的そのもの）。
const AI_CRAWLERS = [
  "GPTBot", // OpenAI 学習
  "ChatGPT-User", // ChatGPT ブラウジング（ユーザ操作）
  "OAI-SearchBot", // OpenAI 検索
  "ClaudeBot", // Anthropic クローラ
  "anthropic-ai", // Anthropic（旧UA）
  "Claude-Web", // Anthropic ブラウジング
  "PerplexityBot", // Perplexity
  "Perplexity-User", // Perplexity（ユーザ操作）
  "Google-Extended", // Gemini/Vertex 学習可否トグル
  "Applebot-Extended", // Apple Intelligence 学習可否トグル
  "CCBot", // Common Crawl（多くの LLM の素データ）
  "cohere-ai", // Cohere
  "Meta-ExternalAgent", // Meta AI
  "Amazonbot", // Amazon
  "Bytespider", // ByteDance
  "DuckAssistBot", // DuckDuckGo AI
];

export default function robots(): MetadataRoute.Robots {
  const disallow = ["/api/", "/dashboard/"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
