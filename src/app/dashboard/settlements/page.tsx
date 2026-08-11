"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";

type Settlement = {
  id: string;
  wallet: string;
  amount: string | null;
  txHash: string;
  network: string;
  resource: string | null;
  createdAt: string | null;
};

export default function DashboardSettlementsPage() {
  const [data, setData] = useState<{ settlements: Settlement[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    dashboardFetch<{ settlements: Settlement[] }>("/api/dashboard/settlements")
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "load_failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-zinc-600">Loading settlements...</p>;
  }

  const { settlements } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">x402 settlements</h2>
        <p className="text-sm text-zinc-600">
          Payment attestations written back by your gateways via{" "}
          <code className="rounded bg-zinc-100 px-1 text-zinc-700">POST /v1/payments/x402</code>. These feed
          the 10% settlement weight in trust scores.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Wallet</th>
              <th className="px-4 py-3 font-medium">Tx</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Resource</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100">
                <td className="px-4 py-3 text-xs text-zinc-600">
                  {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{shorten(row.wallet)}</td>
                <td className="px-4 py-3 font-mono text-xs" title={row.txHash}>
                  {shorten(row.txHash)}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{row.amount ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-zinc-700">{row.resource ?? "—"}</td>
              </tr>
            ))}
            {settlements.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  No settlements attested yet. Use the x402 trust gate with{" "}
                  <code>getPaymentTxHash</code> or call the payments API directly.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shorten(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
