"use client";

import { useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { buttonClass } from "@/components/ui/Button";

type ScoreResult = {
  agentId: string;
  wallet: string | null;
  trustScore: number;
  recommendation: "ALLOW" | "WARN" | "BLOCK";
  manualOverride?: boolean;
  blockReason?: string;
  signals: {
    identity: { registered: boolean; hasMetadataUri: boolean };
    reputation: { feedbackCount: number; avgScore: number; onChainAvgScore: number };
    wallet: { ageDays: number; txCount: number };
    x402?: { paymentCount: number; uniqueDays: number; score: number };
    sybil: { risk: string; flags: string[] };
    manual: { list: string };
  };
  dataCoverage?: {
    ownerIndexer: { status: string; blocksBehind: number | null; staleRisk: boolean };
    settlement: { paymentRows: number; walletHasHistory: boolean };
  };
};

export default function DashboardLookupPage() {
  const [agentId, setAgentId] = useState("");
  const [wallet, setWallet] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await dashboardFetch<ScoreResult>("/api/dashboard/lookup", {
        method: "POST",
        body: JSON.stringify({
          agentId: agentId.trim() || undefined,
          wallet: wallet.trim() || undefined,
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "lookup_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Agent lookup</h2>
        <p className="text-sm text-zinc-600">Search by agent ID and/or wallet address.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Agent ID</span>
          <input
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            placeholder="1"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Wallet (optional verification)</span>
          <input
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
            placeholder="0x..."
            className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className={buttonClass()}
        >
          {loading ? "Looking up..." : "Lookup score"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{dashboardErrorMessage(error)}</p>}

      {result && (
        <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Result</h3>
            <Badge value={result.recommendation} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Agent ID" value={result.agentId} />
            <Item label="Trust score" value={String(result.trustScore)} />
            <Item label="Wallet" value={result.wallet ?? "—"} />
            <Item label="Manual list" value={result.signals.manual.list} />
            <Item label="Manual override" value={result.manualOverride ? "yes" : "no"} />
            <Item label="Block reason" value={result.blockReason ?? "—"} />
            <Item label="Registered" value={result.signals.identity.registered ? "yes" : "no"} />
            <Item label="Metadata URI" value={result.signals.identity.hasMetadataUri ? "yes" : "no"} />
            <Item label="Feedback count" value={String(result.signals.reputation.feedbackCount)} />
            <Item label="On-chain avg score" value={String(result.signals.reputation.onChainAvgScore)} />
            <Item label="Wallet age (days)" value={String(result.signals.wallet.ageDays)} />
            <Item
              label="x402 payments"
              value={String(result.signals.x402?.paymentCount ?? 0)}
            />
            <Item
              label="x402 score"
              value={String(result.signals.x402?.score ?? 50)}
            />
            <Item label="Sybil risk" value={result.signals.sybil.risk} />
          </dl>
          {result.dataCoverage && (
            <p className="text-sm text-zinc-600">
              Coverage: indexer {result.dataCoverage.ownerIndexer.status}
              {result.dataCoverage.ownerIndexer.blocksBehind !== null
                ? ` (${result.dataCoverage.ownerIndexer.blocksBehind} behind)`
                : ""}
              {" · "}
              settlement rows {result.dataCoverage.settlement.paymentRows}
              {result.dataCoverage.settlement.walletHasHistory ? " · wallet has history" : ""}
            </p>
          )}
          {result.signals.sybil.flags.length > 0 && (
            <p className="text-sm text-zinc-600">
              Flags: {result.signals.sybil.flags.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const styles =
    value === "ALLOW"
      ? "bg-emerald-100 text-emerald-800"
      : value === "WARN"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>{value}</span>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-900">{value}</dd>
    </div>
  );
}
