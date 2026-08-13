/**
 * FAQ の設問と答え。/faq が描画し、LP が Q1（x402 とは何か）を引用する。
 *
 * 2026-08-13 UX監査R1: LP は "x402" を12回使って一度も定義していなかった
 * （実測: 定義 0回）。この分野を知らない読者は最初の段落で降りる。定義は
 * 既に /faq の Q1 に承認済みの文章として在ったので、新しいコピーを書かずに
 * ここへ出して LP から引用する。2箇所に同じ文が転記されると片方だけが
 * 直る日が来るので、正典はこのファイル1つにする。
 *
 * 中身は /faq が持っていたものと1文字も変えていない。
 */
export type FaqItem = { question: string; answer: string };

export const FAQS: FaqItem[] = [
  {
    question: "What is x402?",
    answer:
      "x402 is a machine-payment protocol built on the HTTP 402 \"Payment Required\" status code. An API returns 402 with payment terms, the caller (often an AI agent) pays on-chain, and retries the request with proof of payment attached. There's no account, no invoice, and no human approving the transaction — which is what makes it fast for agent-to-agent commerce, and also what makes it blind: the provider sees the payment only after it has already settled.",
  },
  {
    question: "What is ERC-8004?",
    answer:
      "ERC-8004 is an Ethereum standard for on-chain agent identity and reputation. It gives an autonomous agent a registered identity (an agent ID) that can accumulate reputation signals over time, separate from any single wallet address. vet402 reads ERC-8004 identity and reputation data — alongside raw wallet activity — as one of the signal groups behind a trust score.",
  },
  {
    question: "What does vet402 actually compute?",
    answer:
      "Given an ERC-8004 agent ID or a wallet address, vet402 returns a trust score (0-100), a recommendation (ALLOW / WARN / BLOCK), and the underlying signal breakdown: identity, reputation, wallet history, x402 payment history, and sybil-risk indicators. It's meant to be checked in the request path — before you accept a payment or complete a transaction — not reviewed after the fact.",
  },
  {
    question: "Is a vet402 score a guarantee or a credit assessment?",
    answer:
      "No. Scores are informational signals derived from public on-chain data and ERC-8004 records. They do not constitute a guarantee, a credit assessment, KYC, or legal certification of any counterparty. Every API response includes this disclaimer directly in the payload so it travels with the data.",
  },
  {
    question: "Who is vet402 for — agents, or the providers agents pay?",
    answer:
      "Primarily x402 API providers and platforms that accept payment from agents they've never seen before, and need a signal before completing the request. It's equally useful the other direction: an agent that is about to pay an unfamiliar wallet can check that payee's score first. The API doesn't assume which side of the transaction is calling it.",
  },
  {
    question: "Is there an established competitor doing this already?",
    answer:
      "Not as a dedicated category yet. x402 and ERC-8004 only shipped in 2025, so \"score a payee before an agent pays them, specifically for x402 machine payments\" isn't a shelf with incumbents on it the way wallet AML screening or credit scoring is. General crypto wallet-risk tools score addresses for sanctions and fraud exposure, not for x402 payment trust; general agent-identity and reputation projects don't yet gate a payment decision in the request path. We checked this directly rather than assuming it: running vet402's own query through independent AI answer engines returned no vendor at all for \"payee trust API for x402\" — not vet402, not a competitor. That cuts both ways. There's no incumbent to unseat, but it also means the need is still being proven out as x402 transaction volume grows, not a solved problem we're improving on.",
  },
  {
    question: "Does vet402 take custody of funds?",
    answer:
      "No. vet402 is a read-only scoring and attestation API — it never holds, moves, or has signing authority over funds. The SDK's SpendGuard module (non-custodial) helps an agent apply spend policy locally before it pays; vet402 itself only returns scores and records settlement attestations after a payment has already happened on-chain.",
  },
  {
    question: "Which chain does vet402 support?",
    answer:
      "Base. Wallet and ERC-8004 signals are read from Base mainnet. Support for additional chains isn't ruled out, but nothing beyond Base is live today — check the API reference for the current signal set.",
  },
  {
    question: "How much does it cost?",
    answer:
      "The free tier covers 1,000 lookups a month, enough to wire a score check into an x402 flow and see real results before committing to anything. Paid plans add higher volume and score-history access. See the pricing section on the homepage for current tiers.",
  },
  {
    question: "How do I integrate it?",
    answer:
      "Score by agent ID (GET /api/v1/agents/:agentId/score) or by wallet address (GET /api/v1/wallets/:address/score — the primary path for x402 middleware), batch up to 25 at once, or attest an x402 settlement after verification. Full request/response shapes, error codes, and an OpenAPI schema are on the API reference page.",
  },
];

/** LP §1 が引用する x402 の定義（Q1）。索引で引かずに名前で引く。 */
export const X402_DEFINITION = FAQS[0];
