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
    return <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-brand">Loading settlements...</p>;
  }

  const { settlements } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="dash-title">x402 settlements</h2>
        <p className="mt-1 text-sm text-brand">
          Payment attestations written back by your gateways via{" "}
          <code className="font-mono text-brand-deep">POST /v1/payments/x402</code>.
          These feed the 10% settlement weight in trust scores.
        </p>
      </div>

      <div className="table-scroll">
        <table className="fact-table fact-table-fixed">
          <thead>
            <tr>
              <th>Time</th>
              <th>Wallet</th>
              <th>Tx</th>
              <th>Amount</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((row) => (
              <tr key={row.id}>
                <td className="text-xs font-normal text-brand">
                  {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                </td>
                <td className="font-mono text-xs font-normal">{shorten(row.wallet)}</td>
                <td className="font-mono text-xs font-normal" title={row.txHash}>
                  {shorten(row.txHash)}
                </td>
                <td className="font-mono text-xs font-normal">{row.amount ?? "—"}</td>
                <td className="text-xs font-normal text-brand">{row.resource ?? "—"}</td>
              </tr>
            ))}
            {settlements.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-brand-lift">
                  No settlements attested yet. Use the x402 trust gate with{" "}
                  <code className="font-mono">getPaymentTxHash</code> or call the payments API
                  directly.
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
