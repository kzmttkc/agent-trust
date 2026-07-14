import Link from "next/link";

const endpoints = [
  { method: "GET", path: "/api/v1/agents/:agentId/score", note: "Score by ERC-8004 agent ID" },
  { method: "GET", path: "/api/v1/wallets/:address/score", note: "x402 payer path" },
  { method: "POST", path: "/api/v1/scores/batch", note: "Batch lookup" },
  { method: "POST", path: "/api/v1/payments/x402", note: "Settlement attestation (idempotent)" },
  { method: "GET", path: "/api/v1/agents/:agentId/history", note: "Score history (Pro+)" },
];

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
        <h1 className="text-3xl font-semibold tracking-tight">API reference</h1>
        <p className="text-zinc-600">
          Authenticate with <code className="rounded bg-zinc-100 px-1">Authorization: Bearer</code>{" "}
          API key. Full schema:{" "}
          <a
            className="underline"
            href="https://github.com/kzmttkc/agent-trust/blob/main/docs/openapi.yaml"
          >
            docs/openapi.yaml
          </a>
          .
        </p>
      </div>

      <ul className="space-y-3">
        {endpoints.map((ep) => (
          <li
            key={ep.path}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm"
          >
            <p className="font-mono text-zinc-900">
              <span className="font-semibold text-zinc-500">{ep.method}</span> {ep.path}
            </p>
            <p className="mt-1 text-zinc-600">{ep.note}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/" className="underline">
          Home
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
