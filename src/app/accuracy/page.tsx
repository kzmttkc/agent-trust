import type { Metadata } from "next";
import Link from "next/link";
import { VerdictBadge } from "@/components/site/VerdictBadge";
import { computeAccuracyReport, type AccuracyReport } from "@/lib/scoring/accuracy";
import { computeBenchmarkReport, type BenchmarkReport } from "@/lib/scoring/benchmark-report";
import { fetchAccuracyRows, fetchBenchmarkRows } from "@/lib/db/outcome-reader";

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

  // Operator benchmark — self-seeded on purpose, and therefore fetched,
  // computed, and rendered as its OWN section: fetchAccuracyRows excludes
  // these rows at the SQL layer, so nothing here can pad the external
  // figures above. See src/lib/benchmark/dataset.ts for the address sources.
  let benchmark: BenchmarkReport;
  try {
    benchmark = computeBenchmarkReport(await fetchBenchmarkRows(90));
  } catch {
    benchmark = computeBenchmarkReport([]);
  }

  const hasAnyData = report.observedVerdicts > 0;
  const hasBenchmarkData = benchmark.knownBad.total + benchmark.knownGood.total > 0;

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

      {/* external usage — the operator benchmark below is deliberately NOT
          part of these figures (excluded at the SQL layer, outcome-reader.ts):
          self-seeded rows padding the external sample would be exactly the
          asserted-not-measured move this page exists against. */}
      <h2 className="mt-12 text-xl font-semibold text-zinc-900">External usage</h2>
      <p className="mt-2 text-sm text-zinc-500">
        Verdicts requested by API users, judged by what the wallet did afterwards. Operator-run
        benchmark scans are excluded from every number in this section and reported separately
        below.
      </p>

      {/* headline figures */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
                <td className="py-2 pr-2 sm:pr-4">
                  <VerdictBadge verdict={row.recommendation} />
                </td>
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

      {/* operator benchmark — self-seeded and labeled as such. Hiding the
          origin of these rows would turn "measured, not asserted" into a
          fabrication, so the section says who ran the scans in its first
          sentence. */}
      <h2 className="mt-12 text-xl font-semibold text-zinc-900">
        Operator benchmark (labeled addresses)
      </h2>
      <p className="mt-2 text-sm text-zinc-500">
        These scans are run by us, not by customers — a controlled test, published separately so it
        can never be mistaken for (or padded into) external usage. Weekly, the engine scores a
        fixed, versioned set of addresses whose real-world outcome is already public knowledge:
        &ldquo;known bad&rdquo; addresses from the US OFAC sanctions (SDN) list, and &ldquo;known
        good&rdquo; addresses of long-operating, publicly identified organizations and individuals.
        The engine should refuse the former and pass the latter; each address counts once, using
        its most recent scan.
      </p>

      {hasBenchmarkData ? (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 p-6">
              <p className="text-sm text-zinc-500">
                Known-bad addresses flagged (BLOCK or WARN)
              </p>
              <p className="mt-2 text-3xl">
                <Rate value={benchmark.knownBad.detectionRate} />
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {benchmark.knownBad.detected} of {benchmark.knownBad.total} flagged,{" "}
                {benchmark.knownBad.missed} allowed (our misses)
              </p>
            </div>
            <div className="rounded-xl border border-zinc-200 p-6">
              <p className="text-sm text-zinc-500">
                Known-good addresses wrongly blocked (our false positives)
              </p>
              <p className="mt-2 text-3xl">
                <Rate value={benchmark.knownGood.falsePositiveRate} />
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {benchmark.knownGood.allowed} of {benchmark.knownGood.total} allowed,{" "}
                {benchmark.knownGood.warned} warned, {benchmark.knownGood.blocked} blocked
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            {benchmark.scans.toLocaleString("en-US")} benchmark scans in the last 90 days
            {benchmark.lastScanAt
              ? `, most recent ${new Date(benchmark.lastScanAt).toISOString().slice(0, 10)}`
              : ""}
            . Address set and per-address sources are versioned in the codebase
            (methodology below).
          </p>
        </>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No benchmark scans in the current window yet — the first weekly pass publishes here
          automatically.
        </p>
      )}

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
        <li>
          <strong>Operator benchmark.</strong> Run by the operator against a fixed, versioned
          address set and stored with a dedicated source tag
          (<code>operator_benchmark</code>) so it is excluded from all external figures at the
          query level. Known-bad = current ETH entries of the US Treasury OFAC SDN list (public
          domain; retrieved via the nightly extraction at
          {/* same break-all treatment as the endpoint path above — long URLs
              must not force horizontal scroll at 320px */}
          <code className="break-all"> github.com/0xB10C/ofac-sanctioned-digital-currency-addresses</code>).
          Known-good = long-operating addresses publicly attributed via official publications,
          on-chain ENS names, or public label consensus, with no adverse reports at assembly and
          verified activity on Base — the chain the engine scores — so the test measures
          discrimination, not chain coverage. Scoring uses the same engine and fail-closed rules
          as a live lookup, with no customer list attached. Judgment: flagging (BLOCK/WARN) a
          known-bad address is a detection and allowing it is a miss; allowing a known-good
          address is correct and blocking it is a false positive, with warnings on good addresses
          reported separately. The full address set with per-address sources lives in the
          codebase at <code className="break-all">src/lib/benchmark/dataset.ts</code>, and rates
          follow the same {report.minSample}+ minimum-sample rule.
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
