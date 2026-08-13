import type { Metadata } from "next";
import Link from "next/link";
import { VerdictBadge } from "@/components/site/VerdictBadge";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { verifiedPayees } from "@/lib/db/schema";
import { isValidAddress } from "@/lib/chain/client";
import { scorePayeeWallet } from "@/lib/scoring/payee-engine";
import TrackView from "@/components/site/TrackView";

// N-16 — public payee profile: verified identity claim + live payee score.
// The two-sided surface: spending agents check it, payees link it.
//
// NOT CACHED, ON PURPOSE (2026-08-13). This used to be `revalidate = 300`.
// The build has always classified the route as dynamic, so that number never
// actually took effect — but it stated an intent that contradicts the engine:
// scorePayeeWallet refuses to cache a verdict computed with an input it could
// not read, and tests/verdict-consistency.test.ts pins the rule that no
// surface may outlive the engine's own confidence in a verdict. A 300s ISR
// generation is exactly how /agent/[id] pinned one flap of a Blockscout
// outage for five minutes on 2026-08-12. The engine's own 5-minute in-process
// cache already absorbs the repeat cost for healthy verdicts, and it is the
// one cache that knows which verdicts are safe to keep.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return {
    title: `Payee ${address.slice(0, 10)}…`,
    description: "Verified x402 payee: signature-proven identity claim plus a live payee score.",
  };
}

export default async function PayeePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!isValidAddress(address)) notFound();
  const wallet = address.toLowerCase();

  const db = getDb();
  let entry: { name: string; url: string | null; verifiedAt: Date | null } | null = null;
  if (db) {
    try {
      const rows = await db
        .select()
        .from(verifiedPayees)
        .where(eq(verifiedPayees.wallet, wallet))
        .limit(1);
      if (rows[0]) entry = { name: rows[0].name, url: rows[0].url, verifiedAt: rows[0].verifiedAt };
    } catch {
      entry = null;
    }
  }

  let score: {
    value: number;
    recommendation: string;
    dataDepth: string;
    degraded: boolean;
  } | null = null;
  try {
    const result = await scorePayeeWallet(wallet);
    score = {
      value: result.score,
      recommendation: result.recommendation,
      dataDepth: result.dataDepth,
      degraded: result.degraded,
    };
  } catch {
    score = null;
  }

  // 2026-08-06 growth: coarse score band for the payee_view event. The
  // recommendation is the product's own three-way banding (ALLOW/WARN/BLOCK),
  // so we map it instead of inventing new numeric thresholds that could
  // drift from the scoring engine. The wallet address is deliberately NOT a
  // prop — aggregating per-address in analytics is both a privacy smell and
  // useless (the URL path already exists in the automatic pageview).
  // 2026-08-13: `degraded` is its own band. Folding a fail-closed refusal into
  // "low" would make an upstream outage indistinguishable, in the funnel data,
  // from a genuinely bad wallet — and it was a BLOCK-shaped refusal that
  // produced the 88.2% false-positive figure on /accuracy.
  const band = !score
    ? "unavailable"
    : score.degraded
      ? "degraded"
      : score.recommendation === "ALLOW"
        ? "high"
        : score.recommendation === "WARN"
          ? "medium"
          : score.recommendation === "BLOCK"
            ? "low"
            : "unknown";

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        {/* payee_view: the two-sided loop's read side. referrer=external is the
            closest observable proxy for badge-embed inflow (the badge image on a
            payee's own site links here); the referring URL itself is never sent. */}
        <TrackView
          event="payee_view"
          props={{ band, verified: Boolean(entry) }}
          withReferrerType
        />

        <div className="doc-head">
          <div className="doc-head-col">
            <span>Verified Payee</span>
            <span>Subject: Base wallet</span>
            <span>
              {/* この頁のシアン1点。識別が済んでいるかどうかという事実。 */}
              Identity:{" "}
              <span className="text-signal">{entry ? "claimed and proven" : "unclaimed"}</span>
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>Level: L0 identity claim</span>
            <span>Score computed on request</span>
          </div>
        </div>

        <h1 className="mt-10 break-all text-center text-[clamp(0.8125rem,2.6vw,1.125rem)] text-brand-deep">
          {wallet}
        </h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        {entry ? (
          <div className="mt-8 border-l-[3px] border-emerald-700 bg-emerald-50 px-5 py-4">
            <p className="text-emerald-900">{entry.name}</p>
            <p className="mt-2 text-[0.8125rem] text-emerald-800">
              Control of this wallet was proven by signature
              {entry.verifiedAt ? ` on ${entry.verifiedAt.toISOString().slice(0, 10)}` : ""}.
              {entry.url ? (
                <>
                  {" "}
                  Site:{" "}
                  <a
                    href={entry.url}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="break-all underline"
                  >
                    {entry.url}
                  </a>
                </>
              ) : null}
            </p>
            <p className="mt-2 text-xs text-emerald-800">
              Verification proves wallet control only — it is not an endorsement, and the score
              below is computed independently of it.
            </p>
          </div>
        ) : (
          <p className="doc-p mt-8">
            This wallet has not registered a verified-payee profile.{" "}
            <span className="text-brand-lift">
              Own it? POST a signed claim to{" "}
              <code className="break-all text-brand-deep">/api/v1/payees/verify</code> — free, no API
              key, signature required.
            </span>
          </p>
        )}

        <div className="dashbox mt-8">
          <p className="doc-caption">Live payee score</p>
          {score?.degraded ? (
            // 2026-08-13: a degraded result is a refusal, not a reading. The
            // API and the SDK still receive BLOCK — "do not pay this wallet
            // right now" is the correct answer to a caller about to move money
            // when a check could not be completed. But this page is read by
            // humans, and printing "39 BLOCK" here would publish a specific
            // accusation about a named wallet on the strength of an upstream
            // outage, on a site whose masthead is "Nothing on this site is an
            // estimate." So the page says the one true thing instead.
            <>
              <p className="mt-3 font-[family-name:var(--font-display)] text-[1.375rem] font-semibold leading-tight text-brand-deep">
                Not verifiable right now
              </p>
              <p className="mt-2 text-[0.8125rem] text-brand-lift">
                One or more upstream checks could not be completed, so no score is published for
                this wallet. This is not a finding against it. Callers of the API receive a
                fail-closed <code className="text-brand-deep">BLOCK</code> until the checks
                succeed.
              </p>
            </>
          ) : score ? (
          // 2026-08-06 a11y (keyboard+screen-reader persona audit L5): the verdict
          // word used to be separated from the data-depth note by nothing but a
          // visual `ml-2` margin, so innerText read "37 BLOCKdata: thin" and the
          // verdict — the single most important word on this public, unauthenticated
          // page — was announced glued to the next string as "BLOCKdata".
          // Two fixes, both needed: real whitespace between the two elements, and
          // an explicit accessible name so "37" is not heard without its scale.
          // The role="img" + aria-label shape is deliberately the same one the
          // homepage gauge already uses ("Trust score 78 out of 100").
            <p className="mt-3 font-[family-name:var(--font-display)] text-[1.75rem] font-semibold leading-none text-brand-deep">
              <span
                role="img"
                aria-label={`Trust score ${score.value} out of 100, recommendation ${score.recommendation}`}
              >
                {score.value}{" "}
                <VerdictBadge verdict={score.recommendation} className="align-middle" />
              </span>{" "}
              <span className="align-middle font-[family-name:var(--font-sans)] text-xs font-normal text-brand-lift">
                data: {score.dataDepth}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-brand-lift">Score unavailable right now.</p>
          )}
          <p className="doc-note mt-4">
            {/* 2026-08-06 a11y (WCAG 2.4.4): the link text used to be the bare
                path "/accuracy", which reads as "slash accuracy" in a screen
                reader's link list. The descriptive phrase is now the link. */}
            <Link href="/accuracy" className="doc-link">
              Methodology and measured accuracy
            </Link>
            .{" "}
            {/* 2026-08-06 (320px persona audit A-3): this badge URL is ~65 chars
                of unbreakable token and overflowed the viewport by 110px on a
                320px screen, taking the whole page into horizontal scroll. */}
            Badge for your site:{" "}
            <code className="break-all text-brand-deep">/api/badge/{wallet}</code>
          </p>
        </div>

        <p className="mt-8 text-[0.8125rem]">
          <Link href="/payee" className="doc-link">
            Verify another payee
          </Link>
          <span aria-hidden="true" className="mx-2 text-brand-lift">·</span>
          <Link href="/docs/api" className="doc-link">
            API reference
          </Link>
        </p>
      </article>
    </main>
  );
}
