"use client";

import { SITE_URL } from "@/lib/site-url";

export default function DashboardIntegrationsPage() {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1`
      : `${SITE_URL}/api/v1`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Integrations</h2>
        <p className="text-sm text-zinc-600">
          Parallel delivery channels — same trust scores via REST, MCP, or x402 middleware.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="text-base font-semibold">Direct API</h3>
        <p className="text-sm text-zinc-600">Bearer API key. Primary path for gateways and backends.</p>
        <ul className="space-y-1 font-mono text-xs text-zinc-800">
          <li>GET {base}/wallets/:address/score</li>
          <li>GET {base}/agents/:agentId/score</li>
          <li>POST {base}/scores/batch</li>
          <li>POST {base}/payments/x402</li>
        </ul>
        <p className="text-sm text-zinc-600">
          Spec:{" "}
          <a className="underline" href="/docs/api">
            /docs/api
          </a>{" "}
          · TypeScript client: <code>packages/sdk</code>
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="text-base font-semibold">MCP</h3>
        <p className="text-sm text-zinc-600">
          Agent runtimes can self-check before paying: <code>check_wallet_trust</code>,{" "}
          <code>check_agent_trust</code>, <code>explain_trust_score</code>,{" "}
          <code>attest_x402_payment</code>.
        </p>
        <p className="text-sm text-zinc-600">
          Package: <code>@vouchscore/mcp-server</code> — see repo <code>docs/mcp-setup.md</code>.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="text-base font-semibold">x402 trust gate</h3>
        <p className="text-sm text-zinc-600">
          Express sample that blocks <code>BLOCK</code> payers and optionally writes settlements
          back to vet402.
        </p>
        <p className="text-sm text-zinc-600">
          <code>examples/x402-trust-gate</code> · guide: <code>docs/x402-integration.md</code>
        </p>
      </section>
    </div>
  );
}
