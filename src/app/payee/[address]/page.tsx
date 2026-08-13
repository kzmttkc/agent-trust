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
import CodeBlock from "@/components/docs/CodeBlock";
import { getAddress } from "viem";
import { SITE_URL } from "@/lib/site-url";

/**
 * dataDepth の1行定義（2026-08-13 UX監査2巡目 [M6]）。
 * "data: thin" とだけ出していたので、読んだ人には thin が「素性が薄い」のか
 * 「こちらが読めていない」のか区別できなかった（後者は degraded という別の
 * 状態で、上の分岐が受け持っている）。閾値と重みは src/lib/scoring/payee-engine.ts
 * の determineDataDepth / WEIGHTS_BY_DEPTH をそのまま写している。推測しない。
 */
const DATA_DEPTH_NOTE: Record<string, string> = {
  thin: "fewer than 3 payments received, or from fewer than 2 distinct payers. Receiving history carries 15% of this score; wallet health and drain patterns carry the rest.",
  moderate:
    "at least 3 payments received from at least 2 distinct payers. Receiving history carries 35% of this score.",
  rich: "at least 10 payments received across 7 or more days from at least 3 distinct payers. Receiving history carries 50% of this score.",
};

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
  // 表示用だけの正規化。isValidAddress は形だけを見るので getAddress が投げる
  // ことはないが、表示のために例外でページを落とす価値は無いので受けておく。
  let checksummed = wallet;
  try {
    checksummed = getAddress(wallet);
  } catch {
    checksummed = wallet;
  }

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
    unavailable: string[];
  } | null = null;
  try {
    const result = await scorePayeeWallet(wallet);
    score = {
      value: result.score,
      recommendation: result.recommendation,
      dataDepth: result.dataDepth,
      degraded: result.degraded,
      unavailable: result.signalsUnavailable,
    };
  } catch {
    score = null;
  }

  // 2026-08-13: an incompletely measured score says so on the page, in the
  // same plain terms the API reports it. The engine's own field names are the
  // source — a hand-kept second list here would drift from what was actually
  // not read.
  const UNMEASURED_LABELS: Record<string, string> = {
    native_drain: "ETH outflow leg unmeasured",
    usdc_drain: "USDC outflow leg unmeasured",
    wallet_metrics: "wallet history unmeasured",
    outcome_history: "outcome history unmeasured",
  };
  const unmeasuredNote =
    score && !score.degraded && score.unavailable.length > 0
      ? score.unavailable.map((name) => UNMEASURED_LABELS[name] ?? name).join(" · ")
      : null;

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
            {/* 2026-08-13 UX監査2巡目 [M5]: ここは "Level: L0 identity claim" と
                書いていた。LP §2 の L0 は Liveness（エンドポイントが正しく答えるか）
                で、この頁の L0 とは別物 — 同じサイトに L0 の定義が2つあった。
                claim 側から L 記号を外し、事実語だけで何の記録かを言う。 */}
            <span>Claim: wallet control by signature</span>
            <span>Score computed on request</span>
          </div>
        </div>

        {/* 2026-08-13 UX監査2巡目 [m7]: 見出しは EIP-55 チェックサム表記で出す。
            DB のキーもバッジ URL も小文字のままで（照合は今までどおり）、人が
            読み比べる1箇所だけを大文字混じりの正規形にする。ウォレットの
            打ち間違いはチェックサムでしか目視検出できない。 */}
        <h1 className="mt-10 break-all text-center text-[clamp(0.8125rem,2.6vw,1.125rem)] text-brand-deep">
          {checksummed}
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
          <>
          {/* 2026-08-06 a11y (keyboard+screen-reader persona audit L5): the verdict
          // word used to be separated from the data-depth note by nothing but a
          // visual `ml-2` margin, so innerText read "37 BLOCKdata: thin" and the
          // verdict — the single most important word on this public, unauthenticated
          // page — was announced glued to the next string as "BLOCKdata".
          // Two fixes, both needed: real whitespace between the two elements, and
          // an explicit accessible name so "37" is not heard without its scale.
              The role="img" + aria-label shape is deliberately the same one the
              homepage gauge already uses ("Trust score 78 out of 100"). */}
            {/* 2026-08-13 UX監査2巡目 [M6]: 尺度が読み上げにしか無かった。
                aria-label は "out of 100" と言っているのに、目で見える面には
                裸の 37 しか出ていない — 100点満点なのか1000点満点なのかが
                視認面から分からない状態だった。"/ 100" を字面にも出す。 */}
            <p className="mt-3 font-[family-name:var(--font-display)] text-[1.75rem] font-semibold leading-none text-brand-deep">
              <span
                role="img"
                aria-label={`Trust score ${score.value} out of 100, recommendation ${score.recommendation}`}
              >
                {score.value}
                <span className="align-baseline text-[0.9375rem] font-normal text-brand-lift">
                  {" "}
                  / 100
                </span>{" "}
                <VerdictBadge verdict={score.recommendation} className="align-middle" />
              </span>
            </p>
            {/* データの厚みは「判定」ではなく「どれだけ材料があったか」なので、
                判定行から降ろして自分の1行にした。thin/moderate/rich の閾値は
                エンジン側の determineDataDepth と同じものを写している。 */}
            <p className="mt-3 text-[0.8125rem] text-brand-lift">
              <span className="text-brand-deep">data: {score.dataDepth}</span>
              {DATA_DEPTH_NOTE[score.dataDepth] ? ` — ${DATA_DEPTH_NOTE[score.dataDepth]}` : null}{" "}
              <Link href="/docs/api#payee-score" className="doc-link">
                Score breakdown
              </Link>
              .
            </p>
            {unmeasuredNote ? (
              // Partial measurement, disclosed rather than absorbed. The score
              // above is backed by the legs that DID answer, and is capped
              // below ALLOW precisely because this line is here.
              <p className="mt-2 border-l-[3px] border-amber-600 bg-amber-50 px-3 py-2 text-[0.8125rem] text-amber-900">
                Partial measurement — {unmeasuredNote} (upstream outage). The score above reflects
                only the checks that completed and is capped below ALLOW until the rest can be
                read.
              </p>
            ) : null}
          </>
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
            .
          </p>
        </div>

        {/* 2026-08-13 UX監査2巡目 [m6]: バッジは「あなたのサイトへ貼れる」ことが
            価値なのに、これまで置いていたのは裸のパス1本（/api/badge/0x…）で、
            貼るための <img> は読者が自分で書く必要があった。docs と同じ
            CodeBlock を使ってコピーボタン付きで丸ごと渡す。URL は絶対 URL で
            なければ他所のサイトで壊れるので SITE_URL から組む。.svg 付きなのは
            拡張子で判断する埋め込み先（GitHub の README 等）があるため — ルートは
            末尾の .svg を落としてから照合する。 */}
        <div className="dashbox mt-8">
          <p className="doc-caption">Badge for your site</p>
          <p className="mt-3 text-[0.8125rem] text-brand-lift">
            The badge reports whether a signed claim exists for this wallet. It carries no score
            &mdash; a cached number on someone else&apos;s page would outlive its freshness window.
          </p>
          <CodeBlock
            className="mt-3"
            label="Badge embed snippet for this payee"
            code={`<a href="${SITE_URL}/payee/${wallet}">
  <img src="${SITE_URL}/api/badge/${wallet}.svg" alt="vet402 verified payee" height="24">
</a>`}
          />
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
