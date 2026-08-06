import Link from "next/link";
import TrackView from "@/components/site/TrackView";
import TrackedLink from "@/components/site/TrackedLink";

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  note: string;
  request?: string;
  response: string;
};

const endpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/agents/:agentId/score",
    note: "Score by ERC-8004 agent ID. Pass ?wallet=0x... to verify the agent's registered wallet.",
    response: `{
  "agentId": "42",
  "wallet": "0x1234...",
  "trustScore": 78,
  "recommendation": "ALLOW",
  "signals": { "identity": {...}, "reputation": {...}, "wallet": {...}, "x402": {...}, "sybil": {...}, "manual": {...} },
  "breakdown": {
    "components": {
      "identity":   { "score": 100, "weight": 0.2, "contribution": 25 },
      "reputation": { "score": 66,  "weight": 0.3, "contribution": 24.75 },
      "wallet":     { "score": 75,  "weight": 0.2, "contribution": 18.75 },
      "x402":       { "score": 83,  "weight": 0.1, "contribution": 10.38 }
    },
    "weightedSubtotal": 79,
    "sybilPenalty": 0,
    "prePolicyScore": 79
  },
  "scoredAt": "2026-07-14T00:00:00Z",
  "cacheExpiresAt": "2026-07-14T00:05:00Z",
  "disclaimer": "Scores are informational only and do not constitute a guarantee, credit assessment, or investment advice."
}`,
  },
  {
    method: "GET",
    path: "/api/v1/wallets/:address/score",
    note: "Score by wallet address. Primary integration path for x402 API middleware.",
    response: `{
  "agentId": "0",
  "wallet": "0x1234...",
  "trustScore": 61,
  "recommendation": "WARN",
  "signals": { ... },
  "scoredAt": "2026-07-14T00:00:00Z",
  "cacheExpiresAt": "2026-07-14T00:05:00Z",
  "disclaimer": "Scores are informational only and do not constitute a guarantee, credit assessment, or investment advice."
}`,
  },
  {
    method: "POST",
    path: "/api/v1/scores/batch",
    note: "Score up to 25 agents in a single request.",
    request: `{
  "agents": [
    { "agentId": "1" },
    { "agentId": "2", "wallet": "0x..." }
  ]
}`,
    response: `{
  "results": [
    { "agentId": "1", "trustScore": 78, "recommendation": "ALLOW", ... },
    { "agentId": "2", "error": "invalid_agent_id" }
  ]
}`,
  },
  {
    method: "POST",
    path: "/api/v1/payments/x402",
    note: "Attest an x402 payment settlement after payment verification. Idempotent on txHash.",
    request: `{
  "wallet": "0xpayer...",
  "txHash": "0xabc...",
  "amount": "1000000",
  "network": "base",
  "resource": "/api/premium/data"
}`,
    response: `// 201 Created (first attestation)
// 200 OK (already recorded — idempotent replay on txHash)
{
  "ok": true,
  "created": true,
  "id": "b3f1...",
  "wallet": "0xpayer...",
  "txHash": "0xabc..."
}`,
  },
  {
    method: "GET",
    path: "/api/v1/agents/:agentId/history",
    note: "Score history snapshots. Requires Pro or Scale plan. Supports ?limit= (1-100, default 20).",
    response: `{
  "agentId": "42",
  "history": [
    { "trustScore": 78, "recommendation": "ALLOW", "scoredAt": "2026-07-13T00:00:00Z", ... },
    { "trustScore": 74, "recommendation": "ALLOW", "scoredAt": "2026-07-12T00:00:00Z", ... }
  ]
}`,
  },
  {
    method: "GET",
    path: "/api/v1/watchlist",
    note: "List your watched targets (max 50 per key). POST {targetType, target, chainId?} to add; DELETE /api/v1/watchlist/:id to remove. A daily cron re-scores entries and fires the watch.verdict_changed webhook only when the recommendation changes (score jitter without a verdict change is stored but not pushed).",
    response: `{
  "watchlist": [
    { "id": "…", "targetType": "wallet", "target": "0x…", "chainId": 8453,
      "lastScore": 74, "lastRecommendation": "ALLOW", "lastCheckedAt": "2026-08-05T06:30:00Z" }
  ]
}`,
  },
  {
    method: "POST",
    path: "/api/v1/webhooks",
    note: "Register a webhook endpoint (max 5 per key). The signing secret is returned ONCE — store it. events must be a non-empty subset of the events list below. URL must be https to a public host (SSRF-guarded at registration AND at every delivery). GET /api/v1/webhooks lists your endpoints (secrets never returned); DELETE /api/v1/webhooks/:id removes one.",
    request: `{
  "url": "https://your-host.example/vouch-hook",
  "events": ["watch.verdict_changed", "outcome.recorded"]
}`,
    response: `// 201 Created — secret shown once
{
  "id": "…",
  "url": "https://your-host.example/vouch-hook",
  "events": ["watch.verdict_changed", "outcome.recorded"],
  "secret": "whsec_…"
}`,
  },
  {
    method: "GET",
    path: "/api/v1/payees/verify?wallet=0x…&name=Acme+API",
    note: "Preview the exact canonical message for a (wallet, name) pair before signing — no API key, no rate limit. The same message is echoed back in a failed POST's expectedMessage field, so you never have to reverse-engineer the format.",
    response: `{ "message": "Vouch verified payee registration\\nwallet: 0x…\\nname: Acme API\\nThis signature only proves control of the wallet above." }`,
  },
  {
    method: "POST",
    path: "/api/v1/payees/verify",
    note: "Verified payee registration — free, no API key. Sign the canonical message above (fetch it via GET on this same path, or build it yourself: 4 lines, newline-joined — see the response schema) with the payee wallet; a valid signature proves control and publishes /payee/:address plus an embeddable badge at /api/badge/:address. Verification proves wallet control only; scores stay independent.",
    request: `{ "wallet": "0x…", "name": "Acme API", "url": "https://…", "signature": "0x…" }`,
    response: `{ "ok": true, "profile": "/payee/0x…", "badge": "/api/badge/0x…" }`,
  },
];

const errorCodes = [
  { status: "400", meaning: "Bad request", detail: "Malformed body/params (e.g. invalid wallet format, empty batch)." },
  { status: "401", meaning: "Unauthorized", detail: "Missing or invalid API key on the Authorization: Bearer header." },
  { status: "403", meaning: "Forbidden / plan upgrade required", detail: "e.g. score history on a plan below Pro." },
  { status: "429", meaning: "Rate limited", detail: `Monthly quota spent (or an IP abuse throttle tripped). Response includes "retryAfter" (seconds); see Rate limits above.` },
];

export default function ApiDocsPage() {
  return (
    // 2026-08-06 (320px persona audit A-5): `p-8` had no breakpoint, so a 320px
    // screen lost 64px to the page gutter alone — stacked with the card's px-4
    // and the <pre>'s p-3, the readable code column was 198px (62% of the
    // screen) and the longest response example needed 4.5 screen-widths of
    // horizontal scrubbing. The LP already uses the px-5/md:px-8 pattern; docs
    // was the outlier.
    <main className="mx-auto max-w-3xl space-y-10 p-4 md:p-8">
      {/* 2026-08-06 growth: docs_view marks a visitor doing developer-grade
          evaluation — for an API product this is the aha-stage event in
          growth_ledger.py (the true value moment, a scored API call, happens
          server-side and never reaches Plausible). */}
      <TrackView event="docs_view" />
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
        <h1 className="text-3xl font-semibold tracking-tight">API reference</h1>
        <p className="text-zinc-600">
          Authenticate with <code className="rounded bg-zinc-100 px-1">Authorization: Bearer</code>{" "}
          API key. Base URL: <code className="rounded bg-zinc-100 px-1">https://agent-trust-tawny.vercel.app/api/v1</code>
          {" "}(custom domain not yet registered).
        </p>
        <p className="text-sm text-zinc-500">
          Full machine-readable schema:{" "}
          {/* 2026-08-06 growth: openapi_click — pulling the machine-readable
              schema signals codegen/tooling-level integration intent, deeper
              than reading the human docs. */}
          <TrackedLink
            href="https://github.com/kzmttkc/agent-trust/blob/main/docs/openapi.yaml"
            event="openapi_click"
            className="underline"
          >
            <code className="rounded bg-zinc-100 px-1 text-zinc-700">docs/openapi.yaml</code>
          </TrackedLink>{" "}
          on GitHub.
        </p>
      </div>

      {/* 2026-08-06: capacity planning. Quotas were on the pricing page but the
          burst behaviour was nowhere — a synchronous gate needs both to size a
          deployment. Values are read from the code (auth.ts PLAN_LIMITS,
          ip-rate-limit call sites), not asserted. */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Rate limits</h2>
        <p className="text-sm text-zinc-600">
          Scoring is synchronous, so plan for both the monthly quota and the
          burst behaviour below.
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Monthly request quota by plan</caption>
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-2">Plan</th>
                <th scope="col" className="px-4 py-2">Monthly requests</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-zinc-100"><td className="px-4 py-2 text-zinc-700">Free</td><td className="px-4 py-2 font-mono text-zinc-900">1,000</td></tr>
              <tr className="border-b border-zinc-100"><td className="px-4 py-2 text-zinc-700">Pro</td><td className="px-4 py-2 font-mono text-zinc-900">50,000</td></tr>
              <tr className="last:border-0"><td className="px-4 py-2 text-zinc-700">Scale</td><td className="px-4 py-2 font-mono text-zinc-900">500,000</td></tr>
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600">
          <li>
            <strong>Quota is per calendar month (UTC)</strong> and shared across
            all keys on an account. Each <code>/score</code> call is 1 unit; a{" "}
            <code>/scores/batch</code> of N agents is N units. Every scored
            response carries <code>X-RateLimit-Limit</code>,{" "}
            <code>X-RateLimit-Used</code>, and <code>X-RateLimit-Remaining</code>{" "}
            headers so you can track consumption without a separate call.
          </li>
          <li>
            <strong>No per-second burst throttle on authenticated calls today.</strong>{" "}
            Authenticated requests are governed by the monthly quota only — you
            may spend it as fast as you like — so pace client-side if you must
            not exhaust the month in one run. A <code>429</code> with{" "}
            <code>Retry-After</code> means the monthly quota is spent (retry after
            the reported seconds, i.e. next month).
          </li>
          <li>
            <strong>Abuse throttles (IP-based).</strong> To blunt key-guessing and
            scraping, some paths carry an IP burst cap independent of the quota:
            authentication <em>failures</em> are limited to 60/minute/IP, the
            unauthenticated demo scorer to 10/minute/IP, and the public{" "}
            <code>/accuracy</code> and payee-verify endpoints to 20 and 10/minute/IP
            respectively. Valid authenticated traffic does not hit these.
          </li>
        </ul>
      </section>

      <section className="space-y-5">
        {endpoints.map((ep) => (
          <div
            key={ep.path}
            className="space-y-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 text-sm"
          >
            <div>
              {/* 2026-08-06 a11y (screen-reader persona audit): these endpoint
                  names were <p>, so the whole reference exposed exactly two
                  headings ("API reference", "Error codes") and heading-jump
                  navigation could not reach any individual endpoint. They are
                  headings semantically, so they are <h2> now — Tailwind's
                  preflight keeps font-size/weight inherited, so the rendering
                  is byte-identical to the old <p>. */}
              <h2 className="font-mono text-zinc-900">
                <span className="font-semibold text-zinc-500">{ep.method}</span> {ep.path}
              </h2>
              <p className="mt-1 text-zinc-600">{ep.note}</p>
            </div>

            {ep.request && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Request body
                </p>
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label={`Request body for ${ep.method} ${ep.path}`}
                  className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-zinc-400"
                >
                  <code>{ep.request}</code>
                </pre>
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Response
              </p>
              <pre
                tabIndex={0}
                role="region"
                aria-label={`Response for ${ep.method} ${ep.path}`}
                className="overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-zinc-400"
              >
                <code>{ep.response}</code>
              </pre>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        {/* 2026-08-06 N-21: explainability. Integrators kept asking "why this
            number" — the breakdown answers it in the response itself, so a
            compliance log can record the arithmetic, not just the verdict. */}
        <h2 className="text-lg font-semibold tracking-tight">Score breakdown</h2>
        <p className="text-sm text-zinc-600">
          Every scored verdict (agent and wallet endpoints, and each element of a
          batch) carries a <code className="rounded bg-zinc-100 px-1">breakdown</code>{" "}
          object that decomposes the chain score into its four weighted
          components. It is derived from the same numbers the verdict used, so it
          can never disagree with <code className="rounded bg-zinc-100 px-1">trustScore</code>.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600">
          <li>
            <strong>components</strong> — each of <code>identity</code>,{" "}
            <code>reputation</code>, <code>wallet</code>, <code>x402</code> reports
            its 0–100 <code>score</code>, its <code>weight</code>, and its{" "}
            <code>contribution</code> (<code>score × weight ÷ 0.8</code>; the four
            contributions sum to <code>weightedSubtotal</code>). Weights are
            identity&nbsp;0.2, reputation&nbsp;0.3, wallet&nbsp;0.2, x402&nbsp;0.1
            — divided by 0.8 because the customer whitelist/blacklist is a policy
            layer, not a signal.
          </li>
          <li>
            <strong>weightedSubtotal</strong> — the weighted average of the four
            components, before any sybil adjustment.
          </li>
          <li>
            <strong>sybilPenalty</strong> — points removed by sybil / data-
            availability flags (always ≤ 0). The specific flags are in{" "}
            <code>signals.sybil.flags</code>.
          </li>
          <li>
            <strong>prePolicyScore</strong> —{" "}
            <code>weightedSubtotal + sybilPenalty</code>, clamped to 0–100. This
            equals <code>trustScore</code> unless a manual list moved it, in which
            case <code>manualOverride</code> is <code>true</code>. The manual
            layer is deliberately kept out of the breakdown so the chain-derived
            explanation stays separable from policy.
          </li>
        </ul>
        <p className="text-sm text-zinc-600">
          Hard-blocked verdicts (wallet mismatch, unregistered agent) omit{" "}
          <code className="rounded bg-zinc-100 px-1">breakdown</code> — no weighting
          ran — and carry a <code className="rounded bg-zinc-100 px-1">blockReason</code>{" "}
          instead. Treat the field as optional.
        </p>
      </section>

      <section className="space-y-4">
        {/* 2026-08-06 N-15/C-9 doc gap: the watchlist mentioned the
            watch.verdict_changed webhook but nothing documented registration,
            the payload envelope, or signature verification — the receiver could
            not prove a "ALLOW→BLOCK" notice was really from us. This section is
            written from src/lib/webhooks.ts, not from memory. */}
        <h2 className="text-lg font-semibold tracking-tight">Webhooks</h2>
        <p className="text-sm text-zinc-600">
          Vouch is otherwise a pull API. Webhooks turn it into a monitoring
          service: register an endpoint once and we POST you a signed event when
          something you care about changes — most importantly a watched target
          whose verdict moved (e.g. an <code>ALLOW</code> you gated a payment on
          becoming a <code>BLOCK</code>). Register with{" "}
          <code className="rounded bg-zinc-100 px-1">POST /api/v1/webhooks</code>{" "}
          (above); up to 5 endpoints per key.
        </p>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Events</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Webhook event types and their payloads</caption>
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th scope="col" className="px-4 py-2">Event</th>
                  <th scope="col" className="px-4 py-2">Fires when</th>
                  <th scope="col" className="px-4 py-2"><code>data</code> fields</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100">
                  <td className="px-4 py-2 font-mono text-zinc-900">watch.verdict_changed</td>
                  <td className="px-4 py-2 text-zinc-600">A watchlist target&apos;s recommendation changes on a re-scan (daily cron). Verdict changes only — not score jitter.</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">watchId, targetType, target, chainId, previous&#123;score,recommendation&#125;, current&#123;score,recommendation&#125;</td>
                </tr>
                <tr className="border-b border-zinc-100">
                  <td className="px-4 py-2 font-mono text-zinc-900">outcome.recorded</td>
                  <td className="px-4 py-2 text-zinc-600">An outcome (auto-detected or partner-reported) lands on a verdict you requested.</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">trustEventId, outcomeType, source, wallet, agentId</td>
                </tr>
                <tr className="last:border-0">
                  <td className="px-4 py-2 font-mono text-zinc-900">list.changed</td>
                  <td className="px-4 py-2 text-zinc-600">Your own manual whitelist/blacklist changes (also on import) — a team audit trail.</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">action, wallet, listType</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-zinc-600">
            A score is never pushed — scores are computed on demand and pushing a
            cached one would invite treating a stale number as fresh.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Delivery payload</h3>
          <p className="mt-1 text-sm text-zinc-600">
            Every delivery is a JSON POST with this envelope. <code>id</code> is
            unique per event — dedupe on it (see idempotency below).
          </p>
          <pre
            tabIndex={0}
            role="region"
            aria-label="Webhook delivery payload envelope"
            className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-zinc-400"
          >
            <code>{`POST https://your-host.example/vouch-hook
Content-Type: application/json
Vouch-Signature: t=1723000000,v1=5f2b…   (hex HMAC-SHA256)
User-Agent: vouch-webhooks/1

{
  "id": "evt_9f8a…",
  "type": "watch.verdict_changed",
  "createdAt": "2026-08-06T09:30:00.000Z",
  "data": {
    "watchId": "…",
    "targetType": "wallet",
    "target": "0x…",
    "chainId": 8453,
    "previous": { "score": 74, "recommendation": "ALLOW" },
    "current":  { "score": 31, "recommendation": "BLOCK" }
  }
}`}</code>
          </pre>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Verifying the signature</h3>
          <p className="mt-1 text-sm text-zinc-600">
            The <code>Vouch-Signature</code> header is{" "}
            <code>t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, where{" "}
            <code>v1</code> is <code>HMAC-SHA256(secret, `${"{"}t{"}"}.${"{"}rawBody{"}"}`)</code>{" "}
            — the timestamp, a literal dot, then the <strong>raw</strong> request
            body. Recompute it with your <code>whsec_…</code> secret, compare in
            constant time, and reject if the timestamp is more than 5 minutes from
            now (replay guard). The reference implementation is below — copy it
            as-is.
          </p>
          <pre
            tabIndex={0}
            role="region"
            aria-label="Node.js webhook signature verification example"
            className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-zinc-400"
          >
            <code>{`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = new Map(header.split(",").map(p => {
    const i = p.indexOf("="); return [p.slice(0, i), p.slice(i + 1)];
  }));
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // replay guard
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}`}</code>
          </pre>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Delivery, retries &amp; idempotency</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-zinc-600">
            <li>
              <strong>At-most-once, no retry.</strong> Each event is delivered
              once with a 5-second timeout. A non-2xx response or timeout is not
              re-delivered — it increments a failure counter instead. A 2xx resets
              that counter to zero. (Design your handler to catch up by polling
              the watchlist / outcome endpoints, not by relying on redelivery.)
            </li>
            <li>
              <strong>Auto-disable.</strong> After 20 consecutive failed
              deliveries the endpoint is disabled to stop wasting egress on a dead
              URL. Re-create it (<code>POST /api/v1/webhooks</code>) to re-enable —
              a new secret is issued.
            </li>
            <li>
              <strong>Idempotency.</strong> Treat <code>id</code> as an
              idempotency key: store processed ids and ignore a repeat, so a
              duplicate dispatch (e.g. overlapping cron passes) is a no-op on your
              side.
            </li>
            <li>
              <strong>SSRF safety / redirects.</strong> The target URL is
              re-validated at delivery time and redirects are rejected (a redirect
              at delivery is an SSRF vector, not a feature). Point the endpoint at
              its final https URL directly.
            </li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        {/* 2026-08-06: B2B buyers ask for an SLA. Written to the real
            operational posture (single-operator closed beta on Vercel + Neon +
            Base RPC, daily deep health probe), not an aspirational number —
            same honesty discipline as the /accuracy page. Revise the target
            when the operating history and infrastructure justify a commitment. */}
        <h2 className="text-lg font-semibold tracking-tight">Availability</h2>
        <p className="text-sm text-zinc-600">
          Vouch is in closed beta, run by a single operator. We publish our real
          operating posture rather than a contractual uptime figure we can&apos;t
          yet stand behind:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-600">
          <li>
            <strong>No SLA credits during beta.</strong> Service is best-effort,
            with no financial uptime guarantee. When we commit to a numeric target
            it will be backed by measured operating history — we would rather
            under-promise than publish a number the way some vendors publish
            accuracy claims they never measured.
          </li>
          <li>
            <strong>Infrastructure.</strong> Serverless compute (Vercel),
            managed Postgres (Neon), and Base RPC. Availability inherits from
            these providers; there is no independent multi-region failover today.
          </li>
          <li>
            <strong>Fail-closed, not fail-wrong.</strong> When an upstream (RPC,
            indexer, settlement store) is unavailable, the affected signal is
            marked with an <code>*_unavailable</code> flag and penalized rather
            than guessed — a degraded lookup returns a more cautious verdict, not
            a confidently wrong one. Each response&apos;s <code>dataCoverage</code>{" "}
            reports indexer and settlement freshness so you can see what the score
            could draw on.
          </li>
          <li>
            <strong>Monitoring.</strong> A public health endpoint,{" "}
            <code>GET /api/health</code>, returns <code>200</code>/<code>503</code>{" "}
            for uptime pollers. A deeper env/DB/RPC probe runs on a daily cron and
            returns <code>503</code> only on a critical failure (indexer catch-up
            lag is reported, not alerted, to avoid backfill alert fatigue).
          </li>
          <li>
            <strong>Status &amp; incidents.</strong> No hosted status page yet;
            during beta, material incidents are communicated to integrators
            directly. Point your own uptime monitor at <code>/api/health</code>{" "}
            in the meantime.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Error codes</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            {/* 2026-08-06 a11y: caption + scope="col" bring this table up to the
                same standard /accuracy and /leaderboard already meet, so a
                screen reader announces the column a cell belongs to. */}
            <caption className="sr-only">HTTP error codes returned by the Vouch API</caption>
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th scope="col" className="px-4 py-2">Status</th>
                <th scope="col" className="px-4 py-2">Meaning</th>
                <th scope="col" className="px-4 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {errorCodes.map((e) => (
                <tr key={e.status} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-zinc-900">{e.status}</td>
                  <td className="px-4 py-2 text-zinc-700">{e.meaning}</td>
                  <td className="px-4 py-2 text-zinc-600">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-zinc-600">
          Error bodies are shaped as <code className="rounded bg-zinc-100 px-1">{`{ "error": string, "details"?: object }`}</code>.
        </p>
      </section>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/" className="underline">
          Home
        </Link>
        <Link href="/faq" className="underline">
          FAQ
        </Link>
        <Link href="/dashboard" className="underline">
          Dashboard
        </Link>
        <Link href="/dashboard/integrations" className="underline">
          Integrations
        </Link>
      </div>
    </main>
  );
}
