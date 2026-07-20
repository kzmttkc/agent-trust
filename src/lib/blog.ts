export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string; // ISO date
  updatedAt: string; // ISO date
  /** Plain paragraphs, rendered in order. Keep server-renderable (no client-only content). */
  body: string[];
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "why-agent-payments-need-a-trust-score",
    title: "Why agent-to-agent payments need a trust score",
    description:
      "x402 lets an AI agent pay for an API call in one HTTP round trip, but it says nothing about whether the wallet on the other end is worth paying. Here's the gap Vouch fills, and how the score is built.",
    publishedAt: "2026-07-21",
    updatedAt: "2026-07-21",
    body: [
      "x402 solves a narrow, real problem: an agent hits a paid endpoint, gets a 402 Payment Required response with a price, pays on-chain, and retries the request with proof of payment attached. No account, no invoice, no human in the loop. That's the whole point — it's built for machines transacting with machines at a pace no manual approval flow could keep up with.",
      "What x402 does not solve is whether the wallet on the other side of that payment has any track record. A brand-new address with zero history looks identical, at the protocol level, to an address that has settled thousands of legitimate API calls. For a human-run service, that ambiguity is usually fine — chargebacks and reputation exist as a backstop. For an API provider auto-accepting payments from unknown agent wallets at machine speed, it isn't. The failure mode isn't theoretical: sybil wallets, drained faucets, and agents proxying payments through disposable addresses are all cheap to generate and expensive to distinguish from good-faith traffic after the fact.",
      "Vouch computes a trust score for a wallet or an ERC-8004-registered agent ID on Base, and returns it through a single API call: GET /api/v1/wallets/{address}/score, or GET /api/v1/agents/{agentId}/score if the agent has an on-chain identity. The response includes a numeric trustScore, a recommendation (ALLOW / WARN / BLOCK-equivalent tiers), and the underlying signal breakdown — identity, reputation, wallet history, x402 payment history, and sybil-risk indicators — so a caller isn't just trusting a black-box number.",
      "The x402 payment history signal is worth calling out specifically, because it's the one that compounds. Every time a payment settles through Vouch's attestation endpoint (POST /api/v1/payments/x402), that wallet's track record grows. A wallet that has cleanly settled 200 prior x402 payments across different providers looks meaningfully different from one making its first call — and that difference is exactly the information a 402 response alone can't carry.",
      "None of this makes a score a guarantee. The API response says so explicitly: scores are informational only and don't constitute a credit assessment or legal certification. What they do is turn \"unknown wallet, decide now\" into \"wallet with N prior settlements and a stated risk tier, decide now\" — which is enough for most providers to set a sane default (auto-allow above a threshold, hold for review below it) instead of choosing between blocking everyone or blocking no one.",
    ],
  },
];

export function getAllPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
