import Link from "next/link";

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
    note: "List your watched targets (max 50 per key). POST {targetType, target, chainId?} to add; DELETE /api/v1/watchlist/:id to remove. A cron re-scores entries every 6 hours and fires the watch.verdict_changed webhook only when the recommendation changes.",
    response: `{
  "watchlist": [
    { "id": "…", "targetType": "wallet", "target": "0x…", "chainId": 8453,
      "lastScore": 74, "lastRecommendation": "ALLOW", "lastCheckedAt": "2026-08-05T06:30:00Z" }
  ]
}`,
  },
  {
    method: "POST",
    path: "/api/v1/payees/verify",
    note: "Verified payee registration — free, no API key. Sign the canonical message (see response of a failed call, or docs) with the payee wallet; a valid signature proves control and publishes /payee/:address plus an embeddable badge at /api/badge/:address. Verification proves wallet control only; scores stay independent.",
    request: `{ "wallet": "0x…", "name": "Acme API", "url": "https://…", "signature": "0x…" }`,
    response: `{ "ok": true, "profile": "/payee/0x…", "badge": "/api/badge/0x…" }`,
  },
];

const errorCodes = [
  { status: "400", meaning: "Bad request", detail: "Malformed body/params (e.g. invalid wallet format, empty batch)." },
  { status: "401", meaning: "Unauthorized", detail: "Missing or invalid API key on the Authorization: Bearer header." },
  { status: "403", meaning: "Forbidden / plan upgrade required", detail: "e.g. score history on a plan below Pro." },
  { status: "429", meaning: "Rate limited", detail: `Monthly/burst limit exceeded. Response includes "retryAfter" (seconds).` },
];

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8">
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
          <a
            href="https://github.com/kzmttkc/agent-trust/blob/main/docs/openapi.yaml"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            <code className="rounded bg-zinc-100 px-1 text-zinc-700">docs/openapi.yaml</code>
          </a>{" "}
          on GitHub.
        </p>
      </div>

      <section className="space-y-5">
        {endpoints.map((ep) => (
          <div
            key={ep.path}
            className="space-y-3 rounded-lg border border-zinc-200 bg-white px-4 py-4 text-sm"
          >
            <div>
              <p className="font-mono text-zinc-900">
                <span className="font-semibold text-zinc-500">{ep.method}</span> {ep.path}
              </p>
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
        <h2 className="text-lg font-semibold tracking-tight">Error codes</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Meaning</th>
                <th className="px-4 py-2">Detail</th>
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
