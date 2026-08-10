import { headers } from "next/headers";
import { ScorePreviewCard } from "@/components/site/ScorePreviewCard";
import { EndpointCard, type EndpointCardProps } from "@/components/site/EndpointCard";
import { TrustBadgeRow } from "@/components/site/TrustBadgeRow";
import { PricingSection } from "@/components/site/PricingSection";
import TrackView from "@/components/site/TrackView";
import TrackedLink from "@/components/site/TrackedLink";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { buttonClass } from "@/components/ui/Button";

const SITE_URL = "https://agent-trust-tawny.vercel.app";

const ENDPOINTS: EndpointCardProps[] = [
  {
    method: "GET",
    path: "/api/v1/agents/:agentId/score",
    note: "Score by ERC-8004 agent ID. Optionally verify against a registered wallet.",
  },
  {
    method: "GET",
    path: "/api/v1/wallets/:address/score",
    note: "Score by wallet address — the primary path for x402 middleware.",
  },
  {
    method: "POST",
    path: "/api/v1/scores/batch",
    note: "Score up to 25 agents in a single request.",
  },
  {
    method: "POST",
    path: "/api/v1/payments/x402",
    note: "Attest an x402 settlement after payment verification. Idempotent on txHash.",
  },
  {
    method: "GET",
    path: "/api/v1/agents/:agentId/history",
    note: "Score history snapshots, so you can see drift over time.",
    tag: "Pro+",
  },
];

export default async function Home() {
  // 2026-07-25 CTO: ホームページのJSON-LDが0件だった非対称を解消(/faqのみ
  // FAQPage実装済みという状態だった)。Organization+SoftwareApplicationを追加。
  // 数値はsrc/lib/billing/plans.ts(課金の単一情報源)から引用し、架空の価格を書かない。
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Vouch",
    url: SITE_URL,
    description:
      "ERC-8004 agent trust scores on Base for x402 API providers who need to know whether to accept payment from an agent before they take the money.",
    sameAs: ["https://x.com/vouchtrust"],
  };
  const softwareApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Vouch",
    url: SITE_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description:
      "Trust layer for agent commerce. Scores ERC-8004 agent IDs and wallet addresses on Base so x402 API providers can decide whether to accept a payment before completing the request.",
    offers: [
      {
        "@type": "Offer",
        name: BILLING_PLANS.free.name,
        price: "0",
        priceCurrency: "USD",
        description: `${BILLING_PLANS.free.monthlyLimit.toLocaleString()} lookups / month`,
      },
      {
        "@type": "Offer",
        name: BILLING_PLANS.pro.name,
        price: "49",
        priceCurrency: "USD",
        description: `${BILLING_PLANS.pro.monthlyLimit.toLocaleString()} lookups / month`,
      },
      {
        "@type": "Offer",
        name: BILLING_PLANS.scale.name,
        price: "199",
        priceCurrency: "USD",
        description: `${BILLING_PLANS.scale.monthlyLimit.toLocaleString()} lookups / month`,
      },
    ],
  };

  return (
    <main className="bg-white">
      {/* 2026-08-06 growth: lp_view opens the funnel (Verilot parity). Without
          it, CTA click-through rate has no denominator — the automatic
          pageview can't carry utm_source as a queryable prop. */}
      <TrackView event="lp_view" withUtmSource />
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-14 md:px-8 md:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
              Trust layer for agent commerce
            </h1>
            <p className="max-w-xl text-lg text-zinc-600">
              ERC-8004 trust scores on Base. Built for x402 API providers who need to know whether
              to accept payment from an agent before they take the money.
            </p>

            {/* 2026-08-05 R&D (C-1): three same-weight CTAs told a first-time
                visitor nothing about what to do next. One primary action;
                the reference is a text link; Dashboard lives in the header
                where returning users already look for it. */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              {/* transition-[background-color], not `transition`: Tailwind v4's
                  `transition` includes outline-color, which made the focus ring
                  fade in from white over 150ms against a zinc-900 button
                  (1.00:1 contrast mid-transition). Same fix as SiteHeader. */}
              {/* 2026-08-06 growth: lp_cta_click{position} tells us WHICH CTA
                  converts (hero vs final vs pricing), which a plain /signup
                  pageview can never attribute. */}
              <TrackedLink
                href="/signup"
                event="lp_cta_click"
                props={{ position: "hero" }}
                className={buttonClass({ size: "md" })}
              >
                Get a free API key
              </TrackedLink>
              <TrackedLink
                href="/docs/api"
                event="docs_click"
                props={{ position: "hero" }}
                className="text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-deep"
              >
                Read the API reference
              </TrackedLink>
            </div>

            <p className="pt-2 text-sm text-zinc-500">
              Channels: REST · MCP · x402 middleware · TypeScript SDK
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <ScorePreviewCard />
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="border-y border-zinc-200 bg-zinc-50 px-5 py-8 md:px-8">
        <TrustBadgeRow />
      </section>

      {/* Problem statement */}
      <section className="mx-auto max-w-5xl px-5 py-16 md:px-8">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Agents pay before you know who they are
          </h2>
          <p className="mt-3 text-zinc-600">
            x402 lets an agent hit a paid endpoint, pay on-chain, and retry with proof of payment —
            no account, no invoice, no human in the loop. That&rsquo;s what makes it fast. It&rsquo;s also
            what makes it blind: by the time you see the request, the payment already happened.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <p className="font-semibold text-zinc-900">No identity, no history</p>
            <p className="text-sm text-zinc-600">
              A wallet address alone tells you nothing about whether the agent behind it has ever
              behaved well — or exists at all beyond a single transaction.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-zinc-900">Sybils are cheap</p>
            <p className="text-sm text-zinc-600">
              Spinning up a fresh wallet costs nothing. Without a reputation signal, every request
              looks like the first one from a brand-new account.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-zinc-900">Manual review doesn&rsquo;t scale</p>
            <p className="text-sm text-zinc-600">
              Agent-to-agent traffic moves faster than a human can approve. You need a score you
              can check in the request path, not a queue.
            </p>
          </div>
        </div>
      </section>

      {/* Endpoints */}
      <section className="border-t border-zinc-200 bg-zinc-50 px-5 py-16 md:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
              Drop into the request shape you already have
            </h2>
            <p className="mt-3 text-zinc-600">
              One call before you settle. Score by agent ID or wallet, batch up to 25 at once, and
              attest x402 settlements as they land.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {ENDPOINTS.map((endpoint) => (
              <EndpointCard key={endpoint.path} {...endpoint} />
            ))}
          </div>

          <p className="mt-6 text-sm text-zinc-500">
            Full request/response payloads and error codes:{" "}
            <TrackedLink href="/docs/api" event="docs_click" props={{ position: "endpoints" }} className="underline">
              API reference
            </TrackedLink>
            . Docs also cover{" "}
            <a
              href="https://github.com/kzmttkc/agent-trust/blob/main/docs/quickstart.md"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <code className="rounded bg-zinc-100 px-1 text-zinc-700">docs/quickstart.md</code>
            </a>
            ,{" "}
            <a
              href="https://github.com/kzmttkc/agent-trust/blob/main/docs/mcp-setup.md"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <code className="rounded bg-zinc-100 px-1 text-zinc-700">docs/mcp-setup.md</code>
            </a>
            , and{" "}
            <a
              href="https://github.com/kzmttkc/agent-trust/blob/main/docs/x402-integration.md"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <code className="rounded bg-zinc-100 px-1 text-zinc-700">docs/x402-integration.md</code>
            </a>
            .
          </p>
        </div>
      </section>

      {/* Quickstart (2026-08-05 R&D, C-6): the fastest honest proof is running
          it, and the MCP server means "running it" is one command in the
          editor a developer already has open. Package name is the published
          npm scope (@vouchscore). */}
      <section className="mx-auto max-w-5xl px-5 py-16 md:px-8">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Try it from your editor in about a minute
          </h2>
          <p className="mt-3 text-zinc-600">
            The MCP server gives Claude Desktop, Claude Code, and Cursor five trust tools —
            including <code className="rounded bg-zinc-100 px-1 text-sm text-zinc-700">check_payee_trust</code>,
            which answers the question every spending agent should ask:{" "}
            <em>should I pay this wallet?</em>
          </p>
        </div>
        {/* 2026-08-06 (320px persona audit A-1): grid items default to
            `min-width: auto`, so these two items could not shrink below the
            min-content width of the unbreakable code inside them. The track
            blew out to 543px on a 320px screen, the <pre> was laid out at that
            full width, and because clientWidth === scrollWidth its
            `overflow-x: auto` never engaged — the overflow escaped into the
            document instead, giving the whole LP 243px of horizontal scroll and
            cutting off the npm package name mid-string. `min-w-0` lets the item
            shrink so the <pre> scrolls internally, exactly as /docs/api already
            does. */}
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">1. Add the MCP server</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-4 text-xs leading-relaxed text-zinc-100">
              <code>{`{
  "mcpServers": {
    "vouch": {
      "command": "npx",
      "args": ["-y", "@vouchscore/mcp-server"],
      "env": { "VOUCH_API_KEY": "vk_..." }
    }
  }
}`}</code>
            </pre>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">2. Or call it straight from code</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 p-4 text-xs leading-relaxed text-zinc-100">
              <code>{`import { createVouchClient } from "@vouchscore/sdk";

const vouch = createVouchClient({ apiKey: process.env.VOUCH_API_KEY });
const score = await vouch.getWalletScore("0xPayer...");
if (score.recommendation !== "ALLOW") {
  // don't settle the x402 payment
}`}</code>
            </pre>
          </div>
        </div>
        <p className="mt-6 text-sm text-zinc-500">
          Setup details:{" "}
          <TrackedLink href="/docs/api" event="docs_click" props={{ position: "quickstart" }} className="underline">
            docs
          </TrackedLink>{" "}
          — MCP tools, the Express middleware for x402 providers, and the AgentKit spend guard.
        </p>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* Final CTA */}
      <section className="border-t border-zinc-200 px-5 py-16 md:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            Start scoring agents in one request
          </h2>
          <p className="max-w-xl text-zinc-600">
            Free tier covers 1,000 lookups a month — enough to wire it into your x402 flow and see
            real scores before you commit to anything.
          </p>
          {/* transition-[background-color]: keeps outline-color out of the
              transition so the focus ring appears instantly (see hero CTA). */}
          <TrackedLink
            href="/signup"
            event="lp_cta_click"
            props={{ position: "final" }}
            className={buttonClass({ className: "mt-2" })}
          >
            Get API key
          </TrackedLink>
        </div>
      </section>
    </main>
  );
}
