"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";

type Log = {
  id: string;
  agentId: string | null;
  wallet: string | null;
  trustScore: number | null;
  recommendation: string | null;
  createdAt: string | null;
  kind: string | null;
};

export default function DashboardLogsPage() {
  const [data, setData] = useState<{ logs: Log[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    dashboardFetch<{ logs: Log[] }>("/api/dashboard/logs")
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
    return <p className="text-sm text-brand">Loading query logs...</p>;
  }

  const { logs } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="dash-title">Query logs</h2>
        <p className="mt-1 text-sm text-brand">Recent trust score lookups for your API key.</p>
      </div>

      <div className="table-scroll">
        <table className="fact-table fact-table-fixed">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Agent</th>
              <th>Wallet</th>
              <th>Score</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="text-xs font-normal text-brand">
                  {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                </td>
                <td className="font-normal">{log.kind === "payee_score" ? "Payee" : "Wallet"}</td>
                <td className="font-mono text-xs font-normal">{log.agentId ?? "—"}</td>
                <td className="font-mono text-xs font-normal">{log.wallet ?? "—"}</td>
                <td className="num font-normal">{log.trustScore ?? "—"}</td>
                <td>
                  {log.recommendation === "ALLOW" ||
                  log.recommendation === "WARN" ||
                  log.recommendation === "BLOCK" ? (
                    <span
                      className={`marker marker-verdict-${log.recommendation.toLowerCase()}`}
                    >
                      {log.recommendation}
                    </span>
                  ) : (
                    (log.recommendation ?? "—")
                  )}
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-brand-lift">
                  No queries logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
