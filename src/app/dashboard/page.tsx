"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { SITE_URL } from "@/lib/site-url";
import CodeBlock from "@/components/docs/CodeBlock";

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
    return <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-brand">Loading overview...</p>;
  }

  const usagePct = Math.min(100, Math.round((data.usage.count / data.usage.limit) * 100));
  // 2026-08-06 (UX audit items 9 & 10): a brand-new key has zero lookups and
  // the overview was all zeroes with no path forward. Show a first-call guide
  // until the first lookup lands, then it disappears on its own.
  const noLookupsYet = data.totalQueries === 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="dash-title">Overview</h2>
        <p className="mt-1 text-sm text-brand">Monitor usage and plan limits for your API key.</p>
      </div>

      {noLookupsYet && <FirstCallGuide hasKey={Boolean(data.apiKey)} />}

      <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Plan" value={data.plan} subtitle={data.apiKey?.name ?? "Unnamed key"} />
        <Stat
          title="This month"
          value={`${data.usage.count.toLocaleString()} / ${data.usage.limit.toLocaleString()}`}
          subtitle={`${data.usage.remaining.toLocaleString()} remaining`}
        />
        <Stat
          title="Total lookups"
          value={data.totalQueries.toLocaleString()}
          subtitle="All-time API queries"
        />
        <Stat
          title="x402 settlements"
          value={data.settlementAttestations.toLocaleString()}
          subtitle="Attestations from this key"
        />
      </dl>

      <div className="panel">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-brand">Monthly quota</span>
          <span className="text-brand-lift">{usagePct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-[2px] bg-hair">
          <div className="h-full bg-brand-deep" style={{ width: `${usagePct}%` }} />
        </div>
        <p className="mt-2 text-xs text-brand-lift">Period: {data.usage.period}</p>
      </div>

      <div className="rule-single pt-6 text-sm text-brand">
        <p className="doc-caption">Channels</p>
        <ul className="mt-3 space-y-1.5">
          <li>
            <a className="doc-link" href="/dashboard/integrations">
              Integrations
            </a>{" "}
            — API, MCP, x402 middleware
          </li>
          <li>
            <a className="doc-link" href="/dashboard/settlements">
              Settlements
            </a>{" "}
            — attested payment history
          </li>
          <li>
            <a className="doc-link" href="/docs/api">
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
    <div className="rounded-[2px] bg-brand-deep p-5 text-ground">
      <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-white">
        Make your first score lookup
      </p>
      <p className="mt-1 text-sm text-brand-mist">
        No lookups yet. Run one call and this panel is replaced by your live usage.
      </p>
      <CodeBlock code={curl} label="First score lookup" className="mt-3" />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {!hasKey && (
          <Link href="/dashboard/keys" className="text-white underline underline-offset-[0.22em]">
            Create an API key
          </Link>
        )}
        <Link
          href="/payee/0xd8da6bf26964af9d7eed9e03e53415d37aa96045"
          className="text-white underline underline-offset-[0.22em]"
        >
          Or see a live score in the browser
        </Link>
        <Link href="/docs/api" className="text-white underline underline-offset-[0.22em]">
          API reference
        </Link>
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div>
      <dt className="doc-caption">{title}</dt>
      <dd className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold capitalize text-brand-deep">
        {value}
      </dd>
      <dd className="mt-1 text-sm text-brand">{subtitle}</dd>
    </div>
  );
}
