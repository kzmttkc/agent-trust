"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";

type Overview = {
  apiKey: { id: string; name: string | null; plan: string } | null;
  plan: string;
  usage: { period: string; count: number; limit: number; remaining: number };
  totalQueries: number;
};

export default function DashboardOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    dashboardFetch<Overview>("/api/dashboard/overview")
      .then((overview) => {
        if (!cancelled) setData(overview);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "request_failed");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-zinc-600">Loading overview...</p>;
  }

  const usagePct = Math.min(100, Math.round((data.usage.count / data.usage.limit) * 100));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Overview</h2>
        <p className="text-sm text-zinc-600">Monitor usage and plan limits for your API key.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Plan" value={data.plan} subtitle={data.apiKey?.name ?? "Unnamed key"} />
        <Card
          title="This month"
          value={`${data.usage.count.toLocaleString()} / ${data.usage.limit.toLocaleString()}`}
          subtitle={`${data.usage.remaining.toLocaleString()} remaining`}
        />
        <Card
          title="Total lookups"
          value={data.totalQueries.toLocaleString()}
          subtitle="All-time API queries"
        />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-zinc-700">Monthly quota</span>
          <span className="text-zinc-500">{usagePct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full rounded-full bg-zinc-900" style={{ width: `${usagePct}%` }} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">Period: {data.usage.period}</p>
      </div>
    </div>
  );
}

function Card({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold capitalize">{value}</p>
      <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>
    </div>
  );
}
