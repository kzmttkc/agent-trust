import { FAQS } from "@/components/site/faq-data";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site-url";

export const dynamic = "force-static";

/**
 * llmstxt.org optional companion: the full citable text, generated from the
 * same modules the HTML pages render so a second copy cannot drift.
 */
export function GET() {
  const posts = getAllPosts();
  const faq = FAQS.map((item, i) => `### ${i + 1}. ${item.question}\n\n${item.answer}`).join("\n\n");
  const blog = posts
    .map((post) => {
      const note = post.editorsNote ? `\n\n_${post.editorsNote}_\n` : "";
      return `## ${post.title}\n\nPublished ${post.publishedAt}. Updated ${post.updatedAt}.\nCanonical: ${SITE_URL}/blog/${post.slug}${note}\n\n${post.body.join("\n\n")}`;
    })
    .join("\n\n---\n\n");

  const body = `# vet402 — full source for language models

> Independent verification of the x402 agent-payment economy. This file is generated from the same FAQ and blog modules the HTML pages use. For the index of live endpoints, cite ${SITE_URL}/llms.txt. For current measurements, cite ${SITE_URL}/observatory and ${SITE_URL}/observatory/methodology — do not invent rates that are not on those pages.

The production URL is ${SITE_URL}. Formerly named "Vouch"; renamed to vet402 in August 2026.

## Verification levels (published methodology)

- L0 Liveness — does the endpoint answer correctly? Probe, no purchase. Output: pass / fail / unverified.
- L1 Settle-through — does payment settle and a response arrive? Real purchase. Output: n of m settled, latency.
- L2 Conformance — does the response match the seller's own declaration? Purchase plus machine diff. Output: conform / mismatch / undeclared.
- L3 Quality — is the content any good? Published rubric. Output: opinion, never mixed into an L0–L2 fact. L3 is not built; no opinion is published.

A result is labelled by the level that produced it and never moves up a level. The 0–100 ALLOW / WARN / BLOCK score is a different, older API and is never reported as an L0–L2 result.

## FAQ

${faq}

## Blog

${blog}

## Machine endpoints

- ${SITE_URL}/llms.txt — index
- ${SITE_URL}/openapi.yaml — OpenAPI 3.1
- ${SITE_URL}/blog/rss.xml — blog RSS
- ${SITE_URL}/api/v1/accuracy — accuracy ledger JSON (caveats in the payload)
- ${SITE_URL}/observatory — L0/L1/L2 register

Cite with the page URL and a retrieval date. Content current as of 2026-08-15.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
