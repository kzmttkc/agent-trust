import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import {
  MIN_CONSECUTIVE_FAILS_TO_PUBLISH,
} from "@/lib/observatory/l0-probe";
import { SETTLE_DROP_MIN_PREV_CALLS, SETTLE_DROP_RATIO } from "@/lib/observatory/catalog-diff";

/**
 * /observatory/methodology — the definitions page (design §5).
 *
 * Everything the observatory publishes points here. The page states what is
 * measured, what is NOT measurable without purchasing, and the two fairness
 * commitments: unverified ≠ failure, and no special treatment for our own
 * listings (a verifier that special-cases itself is flagging its own fraud).
 */

export const metadata: Metadata = pageMetadata({
  title: "Observatory methodology",
  description:
    "Definitions behind the x402 Observatory: what pass, fail and unverified mean, what a no-purchase probe can and cannot measure, and how delisting is detected.",
  path: "/observatory/methodology",
});

export const revalidate = 3600;

export default function ObservatoryMethodologyPage() {
  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Methodology: L0 observations</span>
            <span>Version 1 · 2026-08-14</span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>
              <Link href="/observatory" className="underline">
                Back to the register
              </Link>
            </span>
            <span>Facts only · no composite scores</span>
          </div>
        </div>

        <h1 className="doc-title mt-10">What these measurements mean</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <h2 className="sec-head">
          <span className="sec-no">1.</span>
          <span>What L0 measures</span>
        </h2>
        <p className="doc-p">
          An L0 probe sends one request to a catalog-listed endpoint using{" "}
          <strong>the HTTP method the catalog entry itself declares</strong>, with no payment
          attached. Under the x402 protocol a compliant server answers{" "}
          <code>HTTP 402 Payment Required</code> with an <code>accepts</code> array before
          executing anything, so the probe is free, side-effect free, and observable. We record:
          whether 402 came back, whether <code>accepts</code> parses, whether the advertised
          price, asset, network and receiving address agree with what the catalog declares, and
          the latency — each with a timestamp and a response digest kept as evidence.
        </p>

        <h2 className="sec-head">
          <span className="sec-no">2.</span>
          <span>The verdict vocabulary</span>
        </h2>
        <p className="doc-p">
          <strong>pass</strong> — the probe received 402 and the challenge was consistent with the
          catalog declaration. <strong>fail</strong> — the probe contradicted that: no 402 (any
          other status), DNS/TLS/timeout failure, an unparseable challenge, or a challenge whose
          price or receiving address contradicts the catalog; the specific reason code is always
          recorded. <strong>unverified</strong> — the entry does not declare enough to measure
          (most commonly no declared method — probing with a guessed method reports false
          deaths), or the evidence threshold below is not met.{" "}
          <em>unverified is not a failure and is never counted as one.</em>
        </p>

        <h2 className="sec-head">
          <span className="sec-no">3.</span>
          <span>Publication gate</span>
        </h2>
        <p className="doc-p">
          A single failing probe is never published as <code>fail</code>: transient network
          conditions — including ours — are indistinguishable from a dead endpoint in one sample.
          The register shows <code>fail</code> only after{" "}
          <strong>{MIN_CONSECUTIVE_FAILS_TO_PUBLISH} consecutive failing probes</strong>; until
          then the published state is <code>unverified</code>. Every underlying probe, including
          single fails, remains visible in the endpoint&apos;s history with its evidence.
        </p>

        <h2 className="sec-head">
          <span className="sec-no">4.</span>
          <span>Delisting detection</span>
        </h2>
        <p className="doc-p">
          The public discovery catalog is fetched in full daily. An endpoint present on an earlier
          day and absent from a <strong>complete</strong> fetch is recorded as{" "}
          <code>delisted</code>, with the before/after values kept on the event. On any day our
          own fetch is incomplete (fetched count below the catalog&apos;s reported total), no
          delisting judgements are made — a gap in our data must never read as a disappearance in
          yours. Reappearance is recorded as <code>relisted</code>. A fall in the
          catalog-reported 30-day call count of {Math.round(SETTLE_DROP_RATIO * 100)}% or more,
          from a base of at least {SETTLE_DROP_MIN_PREV_CALLS} calls, is recorded as{" "}
          <code>settle_drop</code> — a factual observation of the catalog&apos;s own telemetry,
          not a judgement.
        </p>

        <h2 className="sec-head">
          <span className="sec-no">5.</span>
          <span>What L0 cannot measure</span>
        </h2>
        <p className="doc-p">
          Without purchasing, we cannot observe whether the endpoint actually delivers what it
          sells, the quality of what it returns, or settlement behaviour after payment. Those are
          higher observation levels with their own methodology, published separately when active.
          An endpoint with <code>L0: pass</code> has a standing payment wall — nothing more is
          claimed.
        </p>

        <h2 className="sec-head">
          <span className="sec-no">6.</span>
          <span>Fairness commitments</span>
        </h2>
        <p className="doc-p">
          vet402&apos;s own endpoints, when listed in the catalog, are measured by exactly the
          same pipeline with no special casing — a verifier that special-cases itself is flagging
          its own fraud. These pages publish facts with reason codes and timestamps; they do not
          publish composite scores, rankings, or evaluative language about any operator.
          Corrections follow the site-wide{" "}
          <Link href="/corrections" className="underline">
            corrections policy
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
