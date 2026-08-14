import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { pageMetadata, breadcrumbJsonLd } from "@/lib/seo";
import { safeJsonLd } from "@/lib/util/json-ld";
import { SITE_URL } from "@/lib/site-url";
import { TableScroll } from "@/components/site/TableScroll";
import { getObservatoryStats, getObservatoryStatsByChain } from "@/lib/observatory/reader";

/**
 * /observatory/state — the State of x402 headline numbers (design §7).
 *
 * The ecosystem's dead-endpoint and silent-delisting problem has so far been
 * reported only as single-operator anecdotes. These are the same phenomena
 * quantified over the full public catalog — every figure carries its
 * denominator and the fetch-health caveat, and unverified is reported as its
 * own bucket, never folded into fail.
 */

export const metadata: Metadata = pageMetadata({
  title: "State of x402",
  description:
    "Headline measurements over the full public x402 catalog: how many endpoints answer a valid 402 challenge, how many were delisted, and how much of the catalog is machine-verifiable at all.",
  path: "/observatory/state",
});

export const revalidate = 600;

function pct(n: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((n / denom) * 100).toFixed(1)}%`;
}

export default async function ObservatoryStatePage() {
  const stats = await getObservatoryStats();
  const chainStats = await getObservatoryStatsByChain();
  const denom = stats.totalEndpoints;
  const snap = stats.latestSnapshot;
  const fetchComplete = snap ? snap.fetchedCount >= snap.totalCount : false;
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "State of x402",
    description:
      "Aggregate L0 liveness and L1 settle-through measurements over the full public x402 discovery catalog, broken out by chain.",
    url: `${SITE_URL}/observatory/state`,
    creator: { "@type": "Organization", name: "vet402", url: SITE_URL },
    temporalCoverage: snap?.snapshotDate ?? undefined,
    variableMeasured: [
      "endpoints on record",
      "currently listed in catalog",
      "delisted endpoints",
      "L0 published pass",
      "L0 published fail",
      "L0 unverified",
      "L1 paid purchase attempts",
      "L1 settled with on-chain receipt",
    ],
  };
  const breadcrumb = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Observatory", path: "/observatory" },
    { name: "State of x402", path: "/observatory/state" },
  ]);

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: safeJsonLd(datasetJsonLd) }}
        />
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumb) }}
        />

        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Report: State of x402 (L0 aggregate)</span>
            <span>
              {snap ? (
                <>
                  Data as of <span className="text-signal">{snap.snapshotDate}</span>
                  {fetchComplete ? "" : " (incomplete fetch — figures provisional)"}
                </>
              ) : (
                "No catalog snapshot yet"
              )}
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>
              <Link href="/observatory" className="underline">
                Full register
              </Link>
            </span>
            <span>
              <Link href="/observatory/methodology" className="underline">
                Methodology
              </Link>
            </span>
          </div>
        </div>

        <h1 className="doc-title mt-10">State of x402</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <div className="mt-8 flex flex-col gap-1 sm:flex-row sm:gap-0">
          <p className="shrink-0 text-brand-deep sm:w-[10ch]">Abstract</p>
          <p className="min-w-0 max-w-[62ch] text-brand">
            Reports of dead endpoints and silent catalog delisting in the x402 ecosystem have so
            far been anecdotes from individual operators. The figures below are the same
            phenomena measured across the <strong>entire public discovery catalog</strong>, with
            denominators attached. <em>unverified</em> is its own bucket — an entry that cannot
            be machine-checked is not counted as dead.
          </p>
        </div>

        <h2 className="sec-head">
          <span className="sec-no">1.</span>
          <span>Headline measurements</span>
        </h2>
        <TableScroll label="State of x402 headline measurements">
          <table className="fact-table">
            <caption className="sr-only">State of x402 headline measurements</caption>
            <thead>
              <tr>
                <th scope="col">Measurement</th>
                <th scope="col" className="num">
                  Count
                </th>
                <th scope="col" className="num">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-brand">Endpoints on record (denominator)</td>
                <td className="num">{denom.toLocaleString()}</td>
                <td className="num">—</td>
              </tr>
              <tr>
                <td className="text-brand">Currently listed in the catalog</td>
                <td className="num">{stats.activeEndpoints.toLocaleString()}</td>
                <td className="num">{pct(stats.activeEndpoints, denom)}</td>
              </tr>
              <tr>
                <td className="text-brand">Delisted (absent on a complete fetch)</td>
                <td className="num">{stats.delistedEndpoints.toLocaleString()}</td>
                <td className="num">{pct(stats.delistedEndpoints, denom)}</td>
              </tr>
              <tr>
                <td className="text-brand">
                  Payment wall answers a valid 402 (published pass)
                </td>
                <td className="num">{stats.publishedPass.toLocaleString()}</td>
                <td className="num">{pct(stats.publishedPass, denom)}</td>
              </tr>
              <tr>
                <td className="text-brand">
                  Payment wall failing on ≥2 consecutive probes (published fail)
                </td>
                <td className="num">{stats.publishedFail.toLocaleString()}</td>
                <td className="num">{pct(stats.publishedFail, denom)}</td>
              </tr>
              <tr>
                <td className="text-brand">Unverified (gate unmet, or not yet probed)</td>
                <td className="num">{stats.publishedUnverified.toLocaleString()}</td>
                <td className="num">{pct(stats.publishedUnverified, denom)}</td>
              </tr>
              <tr>
                <td className="text-brand">
                  Catalog entries declaring no HTTP method (not machine-checkable)
                </td>
                <td className="num">{stats.methodUndeclared.toLocaleString()}</td>
                <td className="num">{pct(stats.methodUndeclared, denom)}</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>

        <h2 className="sec-head">
          <span className="sec-no">2.</span>
          <span>By chain</span>
        </h2>
        <p className="doc-p">
          L0 observation has always been chain-agnostic and costs nothing to run, so this table
          covers every chain the public catalog lists an endpoint on — not only the chain L1
          purchasing currently targets (Base). Mainnets only; testnet listings are excluded below.
        </p>
        {chainStats.length === 0 ? (
          <p className="doc-p text-brand-lift">No chain data yet.</p>
        ) : (
          <TableScroll label="State of x402 by chain">
            <table className="fact-table">
              <caption className="sr-only">State of x402 by chain</caption>
              <thead>
                <tr>
                  <th scope="col">Chain</th>
                  <th scope="col" className="num">
                    Endpoints
                  </th>
                  <th scope="col" className="num">
                    Listed
                  </th>
                  <th scope="col" className="num">
                    Pass
                  </th>
                  <th scope="col" className="num">
                    Fail
                  </th>
                  <th scope="col" className="num">
                    Unverified
                  </th>
                </tr>
              </thead>
              <tbody>
                {chainStats.map((c) => (
                  <tr key={c.chain}>
                    <td className="text-brand whitespace-nowrap">{c.chain}</td>
                    <td className="num">{c.totalEndpoints.toLocaleString()}</td>
                    <td className="num">{pct(c.activeEndpoints, c.totalEndpoints)}</td>
                    <td className="num">{pct(c.publishedPass, c.totalEndpoints)}</td>
                    <td className="num">{pct(c.publishedFail, c.totalEndpoints)}</td>
                    <td className="num">{pct(c.publishedUnverified, c.totalEndpoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}

        <h2 className="sec-head">
          <span className="sec-no">3.</span>
          <span>L1 — real purchases (covert)</span>
        </h2>
        {stats.l1.attempts === 0 ? (
          <p className="doc-p text-brand-lift">
            No purchases attempted yet. When active, this section reports settlement penetration
            over real paid requests, each backed by an on-chain receipt.
          </p>
        ) : (
          <TableScroll label="L1 covert-purchase measurements">
            <table className="fact-table">
              <caption className="sr-only">L1 covert-purchase measurements</caption>
              <thead>
                <tr>
                  <th scope="col">Measurement</th>
                  <th scope="col" className="num">
                    Count
                  </th>
                  <th scope="col" className="num">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-brand">Paid purchase attempts (money signed and sent)</td>
                  <td className="num">{stats.l1.attempts.toLocaleString()}</td>
                  <td className="num">—</td>
                </tr>
                <tr>
                  <td className="text-brand">Settled with an on-chain receipt</td>
                  <td className="num">{stats.l1.settled.toLocaleString()}</td>
                  <td className="num">{pct(stats.l1.settled, stats.l1.attempts)}</td>
                </tr>
                <tr>
                  <td className="text-brand">Distinct endpoints purchased from</td>
                  <td className="num">{stats.l1.endpointsAttempted.toLocaleString()}</td>
                  <td className="num">—</td>
                </tr>
              </tbody>
            </table>
          </TableScroll>
        )}

        <h2 className="sec-head">
          <span className="sec-no">4.</span>
          <span>Listing-change events observed</span>
        </h2>
        <TableScroll label="Catalog listing-change events observed to date">
          <table className="fact-table">
            <caption className="sr-only">Catalog listing-change events observed to date</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col" className="num">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-brand">delisted — vanished from a complete fetch</td>
                <td className="num">{stats.eventCounts.delisted.toLocaleString()}</td>
              </tr>
              <tr>
                <td className="text-brand">relisted — returned after a delisting</td>
                <td className="num">{stats.eventCounts.relisted.toLocaleString()}</td>
              </tr>
              <tr>
                <td className="text-brand">
                  settle_drop — catalog-reported 30-day calls fell ≥70% from a ≥100 base
                </td>
                <td className="num">{stats.eventCounts.settleDrop.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>

        <h2 className="sec-head">
          <span className="sec-no">5.</span>
          <span>Caveats</span>
        </h2>
        <p className="doc-p">
          Figures are computed from days whose catalog fetch was complete; incomplete days
          withhold delisting judgements entirely. Probes cycle through the catalog on a rolling
          schedule, so <em>unverified</em> includes endpoints simply not yet reached. vet402&apos;s
          own listings, when present, pass through the identical pipeline (
          <Link href="/observatory/methodology" className="underline">
            fairness commitments
          </Link>
          ). None of these figures is an assessment of any individual operator.
        </p>
      </article>
    </main>
  );
}
