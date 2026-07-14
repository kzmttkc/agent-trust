import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-8">
      <div className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">
          Trust layer for agent commerce
        </h1>
        <p className="text-lg text-zinc-600">
          ERC-8004 trust scores on Base. Built for x402 API providers who need to verify agents
          before accepting payment.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Get API key
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          Dashboard
        </Link>
        <Link
          href="/docs/api"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          API reference
        </Link>
      </div>

      <p className="text-sm text-zinc-500">
        Channels: REST · MCP · x402 middleware · TypeScript SDK (
        <code>packages/sdk</code>)
      </p>

      <ul className="space-y-2 text-sm text-zinc-700">
        <li>
          <code className="rounded bg-zinc-100 px-1">GET /api/v1/agents/:agentId/score</code>
        </li>
        <li>
          <code className="rounded bg-zinc-100 px-1">GET /api/v1/wallets/:address/score</code>
        </li>
        <li>
          <code className="rounded bg-zinc-100 px-1">POST /api/v1/scores/batch</code>
        </li>
        <li>
          <code className="rounded bg-zinc-100 px-1">POST /api/v1/payments/x402</code>
          <span className="ml-2 text-zinc-500">settlement attestation</span>
        </li>
      </ul>

      <p className="text-sm text-zinc-500">
        Docs: <code>docs/quickstart.md</code>, <code>docs/mcp-setup.md</code>,{" "}
        <code>docs/x402-integration.md</code>
      </p>
    </main>
  );
}
