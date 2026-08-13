"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { SITE_URL } from "@/lib/site-url";

type Overview = {
  apiKey: { id: string; name: string | null; plan: string } | null;
  plan: string;
  usage: { period: string; count: number; limit: number; remaining: number };
  totalQueries: number;
  settlementAttestations: number;
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
  // 2026-08-06 (UX audit items 9 & 10): a brand-new key has zero lookups and
  // the overview was all zeroes with no path forward. Show a first-call guide
  // until the first lookup lands, then it disappears on its own.
  const noLookupsYet = data.totalQueries === 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Overview</h2>
        <p className="text-sm text-zinc-600">Monitor usage and plan limits for your API key.</p>
      </div>

      {noLookupsYet && <FirstCallGuide hasKey={Boolean(data.apiKey)} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <Card
          title="x402 settlements"
          value={data.settlementAttestations.toLocaleString()}
          subtitle="Attestations from this key"
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

      <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">Channels</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <a className="underline" href="/dashboard/integrations">
              Integrations
            </a>{" "}
            — API, MCP, x402 middleware
          </li>
          <li>
            <a className="underline" href="/dashboard/settlements">
              Settlements
            </a>{" "}
            — attested payment history
          </li>
          <li>
            <a className="underline" href="/docs/api">
              API reference
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}

// First-run onboarding: the single next action for a new key is one scoring
// call. The raw key is shown exactly once at signup and never stored, so we
// cannot echo it here — the curl uses an env-var placeholder and points at
// /dashboard/keys to mint/copy one, plus a zero-setup browser alternative.
function FirstCallGuide({ hasKey }: { hasKey: boolean }) {
  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1`
      : `${SITE_URL}/api/v1`;
  const curl = `curl -H "Authorization: Bearer $VOUCH_API_KEY" \\
  ${base}/wallets/0xd8da6bf26964af9d7eed9e03e53415d37aa96045/score`;
  return (
    <div className="rounded-xl border border-zinc-900/10 bg-zinc-900 p-5 text-zinc-100">
      <p className="text-sm font-semibold">Make your first score lookup</p>
      <p className="mt-1 text-sm text-zinc-300">
        No lookups yet. Run one call and this panel is replaced by your live usage.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-zinc-100">
        <code>{curl}</code>
      </pre>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {!hasKey && (
          <Link href="/dashboard/keys" className="text-white underline">
            Create an API key
          </Link>
        )}
        <Link
          href="/payee/0xd8da6bf26964af9d7eed9e03e53415d37aa96045"
          className="text-white underline"
        >
          Or see a live score in the browser
        </Link>
        <Link href="/docs/api" className="text-white underline">
          API reference
        </Link>
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
