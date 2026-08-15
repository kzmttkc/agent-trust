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
        <h2 className="dash-title">Integrations</h2>
        <p className="mt-1 text-sm text-brand">
          Parallel delivery channels — same trust scores via REST, MCP, or x402 middleware.
        </p>
      </div>

      <section className="rule-single space-y-2 pt-6">
        <h3 className="sub-head mt-0">Direct API</h3>
        <p className="text-sm text-brand">Bearer API key. Primary path for gateways and backends.</p>
        <ul className="space-y-1 font-mono text-xs text-brand-deep">
          <li>GET {base}/wallets/:address/score</li>
          <li>GET {base}/agents/:agentId/score</li>
          <li>POST {base}/scores/batch</li>
          <li>POST {base}/payments/x402</li>
        </ul>
        <p className="text-sm text-brand">
          Spec:{" "}
          <a className="doc-link" href="/docs/api">
            /docs/api
          </a>{" "}
          · TypeScript client: <code className="font-mono text-brand-deep">packages/sdk</code>
        </p>
      </section>

      <section className="rule-single space-y-2 pt-6">
        <h3 className="sub-head mt-0">MCP</h3>
        <p className="text-sm text-brand">
          Agent runtimes can self-check before paying:{" "}
          <code className="font-mono text-brand-deep">check_wallet_trust</code>,{" "}
          <code className="font-mono text-brand-deep">check_agent_trust</code>,{" "}
          <code className="font-mono text-brand-deep">explain_trust_score</code>,{" "}
          <code className="font-mono text-brand-deep">attest_x402_payment</code>.
        </p>
        <p className="text-sm text-brand">
          Package: <code className="font-mono text-brand-deep">@vouchscore/mcp-server</code> — see
          repo <code className="font-mono text-brand-deep">docs/mcp-setup.md</code>.
        </p>
      </section>

      <section className="rule-single space-y-2 pt-6">
        <h3 className="sub-head mt-0">x402 trust gate</h3>
        <p className="text-sm text-brand">
          Express sample that blocks <code className="font-mono text-brand-deep">BLOCK</code>{" "}
          payers and optionally writes settlements back to vet402.
        </p>
        <p className="text-sm text-brand">
          <code className="font-mono text-brand-deep">examples/x402-trust-gate</code> · guide:{" "}
          <code className="font-mono text-brand-deep">docs/x402-integration.md</code>
        </p>
      </section>
    </div>
  );
}
