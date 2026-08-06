import type { Metadata } from "next";
import Link from "next/link";
import { computeAccuracyReport, type AccuracyReport } from "@/lib/scoring/accuracy";
import { fetchAccuracyRows } from "@/lib/db/outcome-reader";

/**
 * /accuracy — the page competitors cannot copy without doing the work.
 *
 * 2026-08-05 R&D. The agent-trust field competes on dimension counts ("7
 * dimensions", "4 pillars"). Nobody publishes what happened AFTER their
 * verdicts. This page does: every score Vouch issues becomes a watched
 * verdict, the outcome-detector and partner reports label what the wallet
 * actually did next, and the aggregate lands here — including the number
 * that flatters us least (BLOCK verdicts later confirmed legitimate).
 *
 * The empty state is deliberate and honest: methodology first, numbers when
 * the sample is real. A page that only appears once the numbers look good
 * would defeat its own point.
 */

export const metadata: Metadata = {
  title: "Score accuracy — measured, not asserted | Vouch",
  description:
    "Vouch publishes what happened after its trust verdicts: the share of ALLOW verdicts that later showed adverse activity, and the share of BLOCK verdicts we got wrong.",
};

export const revalidate = 600;

function Rate({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-zinc-400">insufficient data</span>;
  }
  return <span className="font-semibold text-zinc-900">{value}%</span>;
}

export default async function AccuracyPage() {
  let report: AccuracyReport;
  try {
    report = computeAccuracyReport(await fetchAccuracyRows(90));
  } catch {
    report = computeAccuracyReport([]);
  }

  const hasAnyData = report.observedVerdicts > 0;

  return (
    <main className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Accuracy</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
        Measured, not asserted
      </h1>
      <p className="mt-4 text-zinc-600">
        Most trust products tell you how many dimensions their score has. We think the only number
        that matters is what happened <em>after</em> the verdict. Every score Vouch issues becomes a
        watched event: an on-chain detector and partner reports label what the wallet actually did
        next, and the aggregate is published here — including the number that flatters us least.
      </p>

      {/* headline figures */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 p-6">
          <p className="text-sm text-zinc-500">
            ALLOW verdicts that later showed adverse activity
          </p>
          <p className="mt-2 text-3xl">
            <Rate value={report.allowAdverseRate} />
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 p-6">
          <p className="text-sm text-zinc-500">
            BLOCK verdicts later confirmed legitimate (our false positives)
          </p>
          <p className="mt-2 text-3xl">
            <Rate value={report.blockFalsePositiveRate} />
          </p>
        </div>
      </div>

      {/* table — 2026-08-06 (320px persona audit A-6): the column gutters were
          pr-4 at every width, which pushed the rightmost column ("Adverse
          rate", the single most important number on this page) 29px outside the
          scroll container on a 320px screen. Tightening the gutter below sm
          fits all five columns on screen. */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Outcome counts by recommendation over the last 90 days</caption>
          <thead>
            <tr className="border-b border-zinc-300 text-left text-zinc-500">
              <th scope="col" className="py-2 pr-2 sm:pr-4 font-medium">Verdict</th>
              <th scope="col" className="py-2 pr-2 sm:pr-4 font-medium">Resolved outcomes</th>
              <th scope="col" className="py-2 pr-2 sm:pr-4 font-medium">Went bad</th>
              <th scope="col" className="py-2 pr-2 sm:pr-4 font-medium">Stayed good</th>
              <th scope="col" className="py-2 font-medium">Adverse rate</th>
            </tr>
          </thead>
          <tbody>
            {report.byRecommendation.map((row) => (
              <tr key={row.recommendation} className="border-b border-zinc-100">
                <td className="py-2 pr-2 sm:pr-4 font-mono">{row.recommendation}</td>
                <td className="py-2 pr-2 sm:pr-4">{row.resolved}</td>
                <td className="py-2 pr-2 sm:pr-4">{row.wentBad}</td>
                <td className="py-2 pr-2 sm:pr-4">{row.stayedGood}</td>
                <td className="py-2">
                  <Rate value={row.adverseRate} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-zinc-500">
        {hasAnyData ? (
          <>
            {report.observedVerdicts.toLocaleString("en-US")} verdicts with recorded outcomes in the
            last 90 days ({report.resolvedVerdicts.toLocaleString("en-US")} resolved to good/bad,{" "}
            {report.neutralOnlyVerdicts.toLocaleString("en-US")} neutral,{" "}
            {report.partnerReportedVerdicts.toLocaleString("en-US")} partner-reported).
          </>
        ) : (
          <>
            No resolved outcomes in the current window yet. The collection pipeline is live — this
            page fills in as verdicts age and outcomes land. We publish the methodology first and
            the numbers when the sample is real, because an accuracy page that appears only once
            the numbers look good would defeat its own point.
          </>
        )}{" "}
        Raw JSON: <code className="rounded bg-zinc-100 px-1">GET /api/v1/accuracy</code>.
      </p>

      {/* 2026-08-06 (L4 legal review): publishing measured rates is the point
          of this page, but a bare percentage reads as a performance promise —
          and once real numbers land here, that is close to an implied
          warranty of accuracy. Saying out loud that these are backward-looking
          keeps the page honest without weakening it. Mirrors ToS section 5. */}
      <p className="mt-4 text-sm text-zinc-500">
        These figures are historical: they describe verdicts Vouch has already issued and outcomes
        we have already observed, over a rolling 90-day window. They are not a forecast, a
        service-level commitment, or a warranty of the accuracy of any future score. Past rates
        can and will move as the sample grows and as the behavior we score changes. See the{" "}
        <Link href="/legal/terms" className="underline">
          Terms of Service
        </Link>{" "}
        for what that means in practice.
      </p>

      {/* methodology */}
      <h2 className="mt-12 text-xl font-semibold text-zinc-900">Methodology (v{report.methodologyVersion})</h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-600">
        <li>
          <strong>Outcome sources.</strong> Auto-detected on-chain activity (drain patterns,
          sustained healthy activity, dormancy, ownership changes, negative on-chain feedback) and
          {/* break-all: this 41-char path has no break opportunity, so it
              overflowed a 320px viewport by 26px and took the page into
              horizontal scroll (2026-08-06 audit A-4). Same class the wallet
              display on /payee already uses. */}
          partner reports (<code className="break-all">POST /api/v1/events/:trustEventId/outcome</code>: confirmed fraud,
          confirmed legitimate, chargeback/dispute).
        </li>
        <li>
          <strong>Classification.</strong> Rug-pull outflow, negative feedback, confirmed fraud and
          chargebacks count as <em>bad</em>. Sustained healthy activity and confirmed-legitimate
          count as <em>good</em>. Dormancy and ownership changes are <em>neutral</em> — silence is
          not vindication, so neutral outcomes never move a rate in either direction.
        </li>
        <li>
          <strong>Conflicts.</strong> When one verdict accumulates conflicting outcomes, a partner
          confirmation beats auto detection; within the same tier, <em>bad beats good</em> — ties
          count against us, not for us.
        </li>
        <li>
          <strong>Minimum sample.</strong> A rate is published only at {report.minSample}+ resolved
          verdicts for that bucket; below that the page says &ldquo;insufficient data&rdquo; rather
          than printing noise.
        </li>
        <li>
          <strong>Window.</strong> Rolling 90 days, aggregate counts only — no wallet addresses, no
          agent ids, no per-customer data on this page or in the API response.
        </li>
      </ul>

      <p className="mt-8 text-sm text-zinc-600">
        Run a payment provider and want your outcomes counted?{" "}
        <Link href="/signup" className="underline">
          Get an API key
        </Link>{" "}
        and report them — partner-confirmed outcomes take precedence over our auto-detection.
      </p>
    </main>
  );
}
