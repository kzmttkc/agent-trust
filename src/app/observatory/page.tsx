import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { TableScroll } from "@/components/site/TableScroll";
import { getObservatoryOverview } from "@/lib/observatory/reader";

/**
 * /observatory — the L0 fact table over the x402 catalog (design §5).
 *
 * What this page is NOT: a ranking, a score, or an opinion. Every cell is a
 * measurement with a definition (see /observatory/methodology): the catalog
 * said X, the payment wall answered Y. The verdict vocabulary is closed —
 * pass / fail / unverified — and a fail only appears after the publication
 * gate (two consecutive failing probes), because a single blip must never
 * brand an endpoint dead in public.
 */

export const metadata: Metadata = pageMetadata({
  title: "x402 Observatory",
  description:
    "Daily measurements over the public x402 catalog: does each endpoint's payment wall answer a valid 402 challenge, and is it still listed. Facts with timestamps, no scores.",
  path: "/observatory",
});

export const revalidate = 600;

function VerdictCell({ verdict }: { verdict: "pass" | "fail" | "unverified" }) {
  if (verdict === "pass") return <span className="text-brand-deep">pass</span>;
  if (verdict === "fail") return <span className="text-brand-deep font-semibold">fail</span>;
  return <span className="text-brand-lift">unverified</span>;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
}

export default async function ObservatoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const overview = await getObservatoryOverview({ page });
  const totalPages = Math.max(1, Math.ceil(overview.totalEndpoints / overview.pageSize));

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Register: x402 endpoint observations (L0)</span>
            <span>
              {overview.latestSnapshot ? (
                <>
                  Catalog snapshot:{" "}
                  <span className="text-signal">{overview.latestSnapshot.snapshotDate}</span>{" "}
                  ({overview.latestSnapshot.fetchedCount.toLocaleString()} of{" "}
                  {overview.latestSnapshot.totalCount.toLocaleString()} fetched)
                </>
              ) : (
                "Catalog snapshot: none yet"
              )}
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>
              <Link href="/observatory/methodology" className="underline">
                Methodology
              </Link>
            </span>
            <span>No purchases attached · facts only</span>
          </div>
        </div>

        <h1 className="doc-title mt-10">The x402 Observatory</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <div className="mt-8 flex flex-col gap-1 sm:flex-row sm:gap-0">
          <p className="shrink-0 text-brand-deep sm:w-[10ch]">Abstract</p>
          <p className="min-w-0 max-w-[62ch] text-brand">
            Every endpoint in the public x402 discovery catalog, observed daily: is it still
            listed, and does its payment wall answer a valid <code>402</code> challenge when
            approached with the method it declares. No purchase is ever attached; the challenge
            itself is the observable. <strong>pass / fail / unverified</strong> are defined
            measurements, not opinions —{" "}
            <Link href="/observatory/methodology" className="underline">
              definitions here
            </Link>
            . <em>unverified is not a failure</em>: it means the catalog entry does not declare
            enough for a machine to check.
          </p>
        </div>

        <h2 className="sec-head">
          <span className="sec-no">1.</span>
          <span>Observed endpoints</span>
        </h2>
        <p className="doc-p">
          {overview.totalEndpoints.toLocaleString()} endpoints on record, ordered by observed call
          volume (catalog-reported, last 30 days). Page {page} of {totalPages}.
        </p>

        {overview.rows.length === 0 ? (
          <p className="doc-p text-brand-lift">
            No observations yet. The first catalog ingest populates this table; measurements
            accumulate daily after that.
          </p>
        ) : (
          <TableScroll label="L0 observations over catalog endpoints">
            <table className="fact-table">
              <caption className="sr-only">L0 observations over catalog endpoints</caption>
              <thead>
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Network</th>
                  <th scope="col">Declared method</th>
                  <th scope="col">Catalog</th>
                  <th scope="col">L0</th>
                  <th scope="col">Last probed</th>
                  <th scope="col" className="num">
                    Calls 30d
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/observatory/e/${row.id}`} className="underline">
                        {row.resourceKey.length > 60
                          ? row.resourceKey.slice(0, 57) + "…"
                          : row.resourceKey}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{row.network ?? "—"}</td>
                    <td>{row.method ?? "undeclared"}</td>
                    <td>{row.status}</td>
                    <td>
                      <VerdictCell verdict={row.publishedVerdict} />
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(row.lastProbedAt)}</td>
                    <td className="num">
                      {row.qualityCalls30d === null ? "—" : row.qualityCalls30d.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}

        <nav aria-label="Observatory pages" className="doc-p flex gap-4">
          {page > 1 && (
            <Link href={`/observatory?page=${page - 1}`} className="underline">
              ← Previous
            </Link>
          )}
          {page < totalPages && (
            <Link href={`/observatory?page=${page + 1}`} className="underline">
              Next →
            </Link>
          )}
        </nav>

        <h2 className="sec-head">
          <span className="sec-no">2.</span>
          <span>Reading this table</span>
        </h2>
        <p className="doc-p">
          <strong>Catalog</strong> is presence in the public discovery catalog: <code>active</code>{" "}
          means listed as of the latest snapshot; <code>delisted</code> means the entry was present
          on an earlier day and absent on a complete fetch — with the before/after recorded on the
          endpoint&apos;s page. <strong>L0</strong> is the payment-wall measurement:{" "}
          <code>pass</code> — a probe using the declared method received HTTP 402 with a parseable{" "}
          <code>accepts</code> array consistent with the catalog declaration; <code>fail</code> —
          two or more consecutive probes contradicted that (each with a recorded reason);{" "}
          <code>unverified</code> — not enough declared to measure, or the evidence threshold is
          not yet met. A day on which our own fetch was incomplete produces no delisting
          judgements at all.
        </p>
      </article>
    </main>
  );
}
