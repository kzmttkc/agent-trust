import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { TableScroll } from "@/components/site/TableScroll";
import { getEndpointDetail } from "@/lib/observatory/reader";

/**
 * /observatory/[id] — one endpoint's full fact history (design §5).
 *
 * Every published fail travels with its evidence: timestamp, HTTP status,
 * reason code, latency. Delisting events carry their before/after values.
 * This page is the evidence locker the register links into.
 */

export const revalidate = 600;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await getEndpointDetail(id);
  const name = detail?.endpoint.resourceKey ?? "Endpoint";
  return pageMetadata({
    title: `${name} — L0 observations`,
    description: `Probe history and catalog listing history for ${name}: 402 challenge measurements with timestamps and reason codes.`,
    path: `/observatory/${id}`,
  });
}

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
}

export default async function ObservatoryEndpointPage({ params }: Props) {
  const { id } = await params;
  const detail = await getEndpointDetail(id);
  if (!detail) notFound();

  const { endpoint, probes, events, publishedVerdict } = detail;

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Endpoint record (L0)</span>
            <span>
              Published state: <span className="text-signal">{publishedVerdict}</span>
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>
              <Link href="/observatory" className="underline">
                Back to the register
              </Link>
            </span>
            <span>
              <Link href="/observatory/methodology" className="underline">
                Methodology
              </Link>
            </span>
          </div>
        </div>

        <h1 className="doc-title mt-10 break-all">{endpoint.resourceKey}</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <h2 className="sec-head">
          <span className="sec-no">1.</span>
          <span>Catalog declaration</span>
        </h2>
        <TableScroll label="Catalog declaration for this endpoint">
          <table className="fact-table">
            <caption className="sr-only">Catalog declaration for this endpoint</caption>
            <tbody>
              <tr>
                <td>Resource URL</td>
                <td className="break-all">{endpoint.resourceUrl}</td>
              </tr>
              <tr>
                <td>Source</td>
                <td>{endpoint.source}</td>
              </tr>
              <tr>
                <td>Declared method</td>
                <td>{endpoint.method ?? "undeclared"}</td>
              </tr>
              <tr>
                <td>Network</td>
                <td>{endpoint.network ?? "—"}</td>
              </tr>
              <tr>
                <td>Receiving address</td>
                <td className="break-all">{endpoint.payTo ?? "—"}</td>
              </tr>
              <tr>
                <td>Declared price (base units)</td>
                <td>{endpoint.priceAmount ?? "—"}</td>
              </tr>
              <tr>
                <td>Catalog status</td>
                <td>
                  {endpoint.status}
                  {endpoint.delistedAt ? ` (since ${fmt(endpoint.delistedAt)})` : ""}
                </td>
              </tr>
              <tr>
                <td>First seen / last seen</td>
                <td>
                  {fmt(endpoint.firstSeenAt)} / {fmt(endpoint.lastSeenAt)}
                </td>
              </tr>
              <tr>
                <td>Catalog-reported calls / payers (30d)</td>
                <td>
                  {endpoint.qualityCalls30d?.toLocaleString() ?? "—"} /{" "}
                  {endpoint.qualityPayers30d?.toLocaleString() ?? "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </TableScroll>

        <h2 className="sec-head">
          <span className="sec-no">2.</span>
          <span>Probe history</span>
        </h2>
        {probes.length === 0 ? (
          <p className="doc-p text-brand-lift">No probes recorded yet.</p>
        ) : (
          <TableScroll label="L0 probe history, newest first">
            <table className="fact-table">
              <caption className="sr-only">L0 probe history, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Probed at</th>
                  <th scope="col">Method</th>
                  <th scope="col">Verdict</th>
                  <th scope="col" className="num">
                    HTTP
                  </th>
                  <th scope="col" className="num">
                    Latency
                  </th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {probes.map((p, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{fmt(p.probedAt)}</td>
                    <td>{p.method}</td>
                    <td>{p.verdict}</td>
                    <td className="num">{p.httpStatus ?? "—"}</td>
                    <td className="num">{p.latencyMs === null ? "—" : `${p.latencyMs} ms`}</td>
                    <td>{p.failReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}

        <h2 className="sec-head">
          <span className="sec-no">3.</span>
          <span>Catalog listing events</span>
        </h2>
        {events.length === 0 ? (
          <p className="doc-p text-brand-lift">No listing changes observed.</p>
        ) : (
          <TableScroll label="Catalog listing events, newest first">
            <table className="fact-table">
              <caption className="sr-only">Catalog listing events, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Detected on</th>
                  <th scope="col">Event</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{e.detectedOn}</td>
                    <td>{e.eventType}</td>
                    <td>
                      <code>{JSON.stringify(e.prevValue)}</code>
                    </td>
                    <td>
                      <code>{JSON.stringify(e.newValue)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}

        <p className="doc-p">
          <em>unverified is not a failure</em>; a <code>fail</code> is published only after two
          consecutive failing probes. Definitions:{" "}
          <Link href="/observatory/methodology" className="underline">
            methodology
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
