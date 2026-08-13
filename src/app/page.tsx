import { headers } from "next/headers";
import Link from "next/link";
import TrackView from "@/components/site/TrackView";
import TrackedLink from "@/components/site/TrackedLink";
import { Mark402 } from "@/components/site/Mark402";
import { PricingSection } from "@/components/site/PricingSection";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { buttonClass } from "@/components/ui/Button";
import { SITE_URL } from "@/lib/site-url";
import { safeJsonLd } from "@/lib/util/json-ld";

/**
 * The front page is the memo.
 *
 * 2026-08-13 vet402 — direction contract pinned in src/app/layout.tsx and in
 * output/0813/vet402_lp_design_brief.md. The first viewport reproduces the
 * first page of an RFC: the split header block, the centred title, the
 * tagline, the double rule, the mark, the abstract, and two ways in. Everything
 * below is the body of the same document.
 *
 * Copy is the approved deck, verbatim except for typesetting breaks. Nothing on
 * this page claims a measurement that has not been made: §4 lists only what is
 * running today, §5 says out loud that the observatory is being built.
 */

const HEAD_LEFT = [
  { label: "Network Working Group", value: null },
  { label: "Request for Verification", value: "402" },
  { label: "Category", value: "Independent Measurement" },
  { label: "Status", value: "Building in public", signal: true },
];

const HEAD_RIGHT = ["vet402", "x402 Economy", "August 2026", "Obsoletes: trust scores"];

const CONTENTS = [
  { no: "1.", title: "The problem this memo addresses", href: "#gap", kind: "background" },
  { no: "2.", title: "Verification levels", href: "#methodology", kind: "method" },
  { no: "3.", title: "What a verdict must carry", href: "#evidence", kind: "policy" },
  { no: "4.", title: "Implemented and live", href: "#working", kind: "live" },
  { no: "5.", title: "Status of this work", href: "#status", kind: "building" },
  { no: "A.", title: "Access tiers", href: "#pricing", kind: "terms" },
  { no: "B.", title: "References", href: "#references", kind: "sources" },
];

const LEVELS = [
  {
    level: "L0",
    name: "Liveness",
    question: "Does the endpoint answer correctly?",
    how: "Probe, no purchase",
    output: "pass / fail / unverified",
  },
  {
    level: "L1",
    name: "Settle-through",
    question: "Does payment settle and a response arrive?",
    how: "Real purchase",
    output: "n of m settled, latency",
  },
  {
    level: "L2",
    name: "Conformance",
    question: "Does the response match the seller's own declaration?",
    how: "Purchase + machine diff",
    output: "conform / mismatch / undeclared",
  },
  {
    level: "L3",
    name: "Quality",
    question: "Is the content any good?",
    how: "Published rubric",
    output: "opinion — never mixed with L0–L2",
  },
];

export default async function Home() {
  // 2026-07-25 CTO: ホームページのJSON-LDが0件だった非対称を解消(/faqのみ
  // FAQPage実装済みという状態だった)。数値はsrc/lib/billing/plans.ts(課金の
  // 単一情報源)から引用し、架空の価格を書かない。
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "vet402",
    url: SITE_URL,
    description:
      "Independent verification of the x402 agent-payment economy. vet402 buys what x402 endpoints sell, verifies fulfillment against the seller's own declaration, and publishes the results with evidence.",
    // 2026-08-13: ハンドルの移行完了に伴い @vouchtrust → @vet_402
    // （@vet402 は取得不可だったため下線入り）。
    sameAs: ["https://x.com/vet_402"],
  };
  const softwareApplicationJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "vet402",
    url: SITE_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description:
      "Verification API for the x402 agent-payment economy. Prove control of a payee wallet, check a payee before paying it, and read the public accuracy ledger.",
    offers: [
      {
        "@type": "Offer",
        name: BILLING_PLANS.free.name,
        price: "0",
        priceCurrency: "USD",
        description: `${BILLING_PLANS.free.monthlyLimit.toLocaleString()} lookups / month`,
      },
      {
        "@type": "Offer",
        name: BILLING_PLANS.pro.name,
        price: "49",
        priceCurrency: "USD",
        description: `${BILLING_PLANS.pro.monthlyLimit.toLocaleString()} lookups / month`,
      },
      {
        "@type": "Offer",
        name: BILLING_PLANS.scale.name,
        price: "199",
        priceCurrency: "USD",
        description: `${BILLING_PLANS.scale.monthlyLimit.toLocaleString()} lookups / month`,
      },
    ],
  };

  return (
    // 2026-08-13 UX監査2巡目 [M8]: 1440×720 で2本の CTA の下端が 843px にあり、
    // fold の 123px 下だった。RFC 第1面の要素と順序（ヘッダ／表題／タグライン／
    // ダブルルール／マーク／Abstract／2本の入口）は一つも動かさず、行間と
    // マークの寸法だけを詰めて 712px に収めている。ここは md:pt-12 を外した分。
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-6">
      {/* 2026-08-06 growth: lp_view opens the funnel (Verilot parity). Without
          it, CTA click-through rate has no denominator — the automatic
          pageview can't carry utm_source as a queryable prop. */}
      <TrackView event="lp_view" withUtmSource />
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(softwareApplicationJsonLd) }}
      />

      <article className="sheet">
        {/* ================= RFC first page ================= */}
        <div className="doc-head">
          <div className="doc-head-col">
            {HEAD_LEFT.map((row) => (
              <span key={row.label}>
                {row.label}
                {row.value ? ": " : ""}
                {row.value ? (
                  // シアンは1画面1箇所。この Status 値がその1点で、装飾ではなく
                  // 「いまどの段階にあるか」という事実に充てている。
                  // 色は #0e7490（白地 5.36:1）。ブランドシートの #0891b2 は
                  // 白地 3.68:1 で本文サイズの文字には AA が足りない。
                  <span className={row.signal ? "text-signal" : undefined}>{row.value}</span>
                ) : null}
              </span>
            ))}
          </div>
          <div className="doc-head-col">
            {HEAD_RIGHT.map((value) => (
              <span key={value}>{value}</span>
            ))}
          </div>
        </div>

        <h1 className="doc-title mt-6">
          vet402 — Independent Verification of the x402 Agent-Payment Economy
        </h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-center text-brand-lift">
          We buy. We settle. We publish the measurements.
        </p>

        <div className="rule-double mx-auto mt-4 w-full max-w-[34ch]" />

        {/* マークは 132 → 104px（モバイルと同寸）。[M8] の 123px のうち 28px を
            ここから出している。紙面の中央・ダブルルールの直下という位置は同じ。 */}
        <div className="mt-5 flex justify-center">
          <Mark402 animate className="h-auto w-[104px]" />
        </div>

        <div className="mt-5 flex flex-col gap-1 sm:flex-row sm:gap-0">
          <p className="shrink-0 text-brand-deep sm:w-[10ch]">Abstract</p>
          <p className="min-w-0 max-w-[62ch] text-brand">
            {/* 引用符は straight。RFC の原典はプレーンテキストで、curly quote は
                存在しない。/faq と /legal も straight で統一されている。

                2026-08-13 [M8]: 5行 → 3行。落としたのは "Every verdict will carry
                a transaction hash, a timestamp and reproduction steps." の1文で、
                これは §3.1 が同じ内容をより強い形（「無ければ公開しない」）で
                述べている重複。Abstract が §3 を先取りするのをやめただけで、
                デッキの主張は1つも減っていない。 */}
            vet402 buys what x402 endpoints actually sell, verifies fulfillment against the
            seller&apos;s own declaration, and publishes the results with evidence.{" "}
            <strong>Nothing on this site is an estimate.</strong>
          </p>
        </div>

        {/* 2026-08-06 growth: lp_cta_click{position} tells us WHICH CTA converts
            (hero vs final vs pricing), which a plain /signup pageview can never
            attribute. */}
        <div className="mt-5 flex flex-wrap gap-3 sm:pl-[10ch]">
          <TrackedLink
            href="#methodology"
            event="lp_cta_click"
            props={{ position: "hero_method" }}
            className={buttonClass({ size: "md", className: "w-full sm:w-auto" })}
          >
            Read the methodology
          </TrackedLink>
          <TrackedLink
            href="/payee"
            event="lp_cta_click"
            props={{ position: "hero_verify" }}
            className={buttonClass({
              variant: "secondary",
              size: "md",
              // 縦に積まれる幅では、内容幅のままだと2本の右端が揃わず雑に見える。
              className: "w-full sm:w-auto",
            })}
          >
            Verify a payee now
          </TrackedLink>
        </div>

        {/* ================= Table of contents ================= */}
        <nav aria-label="Table of contents" className="mt-14">
          <p className="doc-caption">Contents</p>
          <div className="mt-4 border-t border-hair pt-2">
            {CONTENTS.map((item) => (
              <Link key={item.href} href={item.href} className="toc-row">
                <span className="toc-no">{item.no}</span>
                <span className="toc-label">{item.title}</span>
                <span className="toc-lead" aria-hidden="true" />
                <span className="toc-page">{item.kind}</span>
              </Link>
            ))}
          </div>
        </nav>

        {/* ================= 1. The gap ================= */}
        <h2 id="gap" className="sec-head scroll-mt-24">
          <span className="sec-no">1.</span>
          <span>The problem this memo addresses</span>
        </h2>

        <div className="mt-6 space-y-5">
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">1.1</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              x402 settles payments finally and irreversibly. Proof of payment exists on-chain.{" "}
              <strong>Proof of delivery does not exist anywhere.</strong>
            </p>
          </div>
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">1.2</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              Registries can be written for cents: 98.7% of ERC-8004 reputation feedback has no
              verifiable transaction behind it.{" "}
              <a href="#ref-arxiv" className="ref-mark">
                [ARXIV-2606]
              </a>
            </p>
          </div>
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">1.3</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              Directory metrics can be manufactured: roughly half of observed x402 traffic is
              self-dealing.{" "}
              <a href="#ref-artemis" className="ref-mark">
                [ARTEMIS-2026]
              </a>
            </p>
          </div>
        </div>

        {/* ================= 2. Method ================= */}
        <h2 id="methodology" className="sec-head scroll-mt-24">
          <span className="sec-no">2.</span>
          <span>Verification levels</span>
        </h2>
        <p className="doc-p">
          Four levels, in order of what they cost us to run and what they prove. A result never
          moves up a level: an L0 probe cannot report settlement, and an L3 opinion is never
          folded into an L0&ndash;L2 fact.
        </p>

        {/* 表は sm 以上。320–639px では同じ配列を定義リストで積む（4列の散文表を
            横スクロールさせると、この表で一番重要な Output 列が最初から画面外に
            出る）。表示されない側は display:none なので支援技術にも二重に出ない。 */}
        <div className="table-scroll hidden sm:block">
          <table className="fact-table fact-table-fixed">
            <caption className="sr-only">
              vet402 verification levels: what each level asks, how it is run, and what it outputs
            </caption>
            {/* 列幅は「その列に入る一番長い1語」から決める。表示書体が列ごとに
                違うので桁数だけでは決まらない（Level 列だけ Martian Mono の
                0.70em、他は Fragment Mono の 0.618em）。
                  Level    Conformance   11桁 × 0.70em × 13px = 100px (+20 pad)
                  Question declaration?  12桁 × 0.618em × 13px = 96px (+20 pad)
                  How      machine       7桁 = 56px (+20 pad)
                  Output   unverified   10桁 = 80px（最終列は右パディング0）
                24% は 1440px の紙面(665px)で 160px を Level 列に配り、
                `Settle-through`(127px) すら1語のまま置ける。
                .fact-table-fixed の min-width が下限を押さえている。 */}
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "29%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "29%" }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Question</th>
                <th scope="col">How</th>
                <th scope="col">Output</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((row) => (
                <tr key={row.level}>
                  {/* 段名を nowrap で括るのは、ハイフンでの分割を止めるため。
                      列幅に入らない時、ブラウザは空白より先にハイフンで折る:
                      `L1 Settle-through`(155px) が 140px の内寸に入らないと
                      `L1 Settle-` / `through` になり、監査が拾った
                      `L2 Conformanc / e` と同じ形に見える。nowrap にすると
                      折れる場所が語間だけになり `L1` / `Settle-through` になる。
                      1行に収める案（LEVEL 列 27%）も試したが、その幅を保つには
                      表の下限が 648px になり、640–827px の画面で表が横スクロール
                      する。語間で折るほうが安い。 */}
                  <td>
                    <span className="whitespace-nowrap">{row.level}</span>{" "}
                    <span className="whitespace-nowrap">{row.name}</span>
                  </td>
                  <td>{row.question}</td>
                  <td>{row.how}</td>
                  <td className="text-brand-deep">{row.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="mt-6 sm:hidden">
          {LEVELS.map((row) => (
            <div key={row.level} className="border-t border-hair py-4 first:border-t-brand-deep">
              <dt className="font-[family-name:var(--font-display)] font-semibold text-brand-deep">
                {row.level} {row.name}
              </dt>
              <dd className="mt-2 space-y-1 text-[0.8125rem] text-brand">
                <p>{row.question}</p>
                <p className="text-brand-lift">How: {row.how}</p>
                <p className="text-brand-deep">Output: {row.output}</p>
              </dd>
            </div>
          ))}
        </dl>

        {/* 2026-08-13 UX監査2巡目 [M5]: この §2 の L0–L3 と、API/SDK が今日返して
            いる trust score (0–100 / ALLOW-WARN-BLOCK) は別の物差しなのに、両方が
            同じサイトの上に無説明で並んでいた（/payee は "Level: L0" と
            "39 BLOCK" を同じ画面に出していた）。関係を書く場所はここ1箇所に決め、
            docs 側からはここへリンクする。実績の先取りをしないため、置き換えは
            すべて未来形で書く。 */}
        <div className="mt-8 flex gap-4">
          <span className="w-[4ch] shrink-0 text-brand-lift">2.1</span>
          <p className="min-w-0 max-w-[64ch] text-brand">
            The trust score this API returns today &mdash; 0&ndash;100, banded{" "}
            <span className="whitespace-nowrap">ALLOW / WARN / BLOCK</span> &mdash; predates these
            levels. It stays available to API and SDK callers during the transition. Observatory
            verdicts (L0&ndash;L2) replace it as they ship, and both will run side by side until
            then. A score is never reported as an L0&ndash;L2 result.{" "}
            <Link href="/docs/api#score-breakdown" className="doc-link">
              How the score is composed
            </Link>
            .
          </p>
        </div>

        {/* ================= 3. Evidence rules ================= */}
        <h2 id="evidence" className="sec-head scroll-mt-24">
          <span className="sec-no">3.</span>
          <span>What a verdict must carry</span>
        </h2>

        <div className="mt-6 space-y-5">
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">3.1</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              A failing verdict publishes with raw log, transaction hash, timestamp and reproduction
              steps &mdash; <strong>or it does not publish.</strong>
            </p>
          </div>
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">3.2</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              Unverifiable is not a verdict. We say <strong>&quot;unverified&quot;</strong>, never
              &quot;bad&quot;.
            </p>
          </div>
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">3.3</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              Sellers can dispute any result and trigger a free re-verification. Corrections are
              logged publicly.
            </p>
          </div>
        </div>

        {/* ================= 4. Working today ================= */}
        <h2 id="working" className="sec-head scroll-mt-24">
          <span className="sec-no">4.</span>
          <span>Implemented and live</span>
        </h2>
        <p className="doc-p">
          Everything in this section is running right now and can be checked without asking us.
        </p>

        <div className="mt-6 divide-y divide-hair border-t border-brand-deep">
          <ItemRow
            state="live"
            title="Verified Payee"
            body={
              <>
                Prove control of a wallet by signature, get a public verification page and an SVG
                badge.
              </>
            }
            action={{ label: "Verify a payee", href: "/payee", event: "lp_cta_click", position: "s4_payee" }}
          />
          <ItemRow
            state="live"
            title="Drop-in middleware, REST API and MCP tool"
            body={
              <>
                An x402 middleware package, a REST API, and an MCP tool that answers the question a
                spending agent should ask before it pays.
              </>
            }
            action={{ label: "API reference", href: "/docs/api", event: "docs_click", position: "s4_docs" }}
          />
          <ItemRow
            state="live"
            title="Public accuracy ledger"
            body={
              <>
                Every past verdict and its outcome, misfire rate included &mdash; published whether
                or not the numbers flatter us.
              </>
            }
            action={{ label: "Measured accuracy", href: "/accuracy", event: "docs_click", position: "s4_accuracy" }}
          />
        </div>

        {/* ================= 5. The observatory ================= */}
        <h2 id="status" className="sec-head scroll-mt-24">
          <span className="sec-no">5.</span>
          <span>Status of this work</span>
        </h2>
        <p className="doc-p">
          Under construction, in the open. These are not measurements yet, and this page will not
          describe them as though they were.
        </p>

        <div className="mt-6 divide-y divide-hair border-t border-brand-deep">
          <ItemRow
            state="building"
            title="The observatory"
            body={
              <>
                A continuous catalog of x402 endpoints across chains, probed daily, with delisting
                alerts for claimed sellers.
              </>
            }
          />
          <ItemRow
            state="building"
            title="Writing to the empty registry"
            body={
              <>
                Verification records will be written to the ERC-8004 Validation Registry &mdash; the
                one registry that is still empty.
              </>
            }
          />
        </div>

        <div className="dashbox mt-8 max-w-[64ch]">
          <p className="doc-caption">Follow the build</p>
          <p className="mt-3 text-brand">
            <TrackedLink
              href="https://x.com/vet_402"
              event="follow_click"
              props={{ channel: "x" }}
              className="doc-link"
            >
              X @vet_402
            </TrackedLink>
            <span aria-hidden="true" className="mx-2 text-brand-lift">·</span>
            <TrackedLink
              href="https://github.com/kzmttkc/agent-trust"
              event="follow_click"
              props={{ channel: "github" }}
              className="doc-link"
            >
              GitHub
            </TrackedLink>
          </p>
        </div>

        {/* ================= Appendix A. Access tiers ================= */}
        <PricingSection />

        {/* ================= Appendix B. References ================= */}
        <h2 id="references" className="sec-head scroll-mt-24">
          <span className="sec-no">B.</span>
          <span>References</span>
        </h2>
        <dl className="mt-6 space-y-5 text-[0.8125rem]">
          <div id="ref-arxiv" className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-brand-deep sm:w-[16ch]">[ARXIV-2606]</dt>
            <dd className="min-w-0 max-w-[58ch] text-brand">
              98.7% of ERC-8004 reputation feedback has no verifiable transaction behind it.{" "}
              <a
                href="https://arxiv.org/abs/2606.26028"
                target="_blank"
                rel="noopener noreferrer"
                className="doc-link"
              >
                arXiv:2606.26028
              </a>
            </dd>
          </div>
          <div id="ref-artemis" className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-brand-deep sm:w-[16ch]">[ARTEMIS-2026]</dt>
            <dd className="min-w-0 max-w-[58ch] text-brand">
              Roughly half of observed x402 traffic is self-dealing. Artemis, x402 activity
              analysis, 2026.
            </dd>
          </div>
        </dl>
      </article>
    </main>
  );
}

/**
 * ItemRow — one entry in §4 / §5. The state marker is the whole point of the
 * row: `live` means it runs today, `building` means it does not. Keeping the
 * two states in one visual grammar is what stops §5 from reading as a claim.
 */
function ItemRow({
  state,
  title,
  body,
  action,
}: {
  state: "live" | "building";
  title: string;
  body: React.ReactNode;
  action?: { label: string; href: string; event: string; position: string };
}) {
  return (
    <div className="flex flex-col gap-2 py-5 sm:flex-row sm:gap-6">
      <div className="shrink-0 sm:w-[14ch] sm:pt-0.5">
        <span className={state === "live" ? "marker marker-live" : "marker marker-plan"}>
          {state === "live" ? "implemented" : "building"}
        </span>
      </div>
      <div className="min-w-0 max-w-[58ch]">
        <p className="font-[family-name:var(--font-display)] font-semibold text-brand-deep">
          {title}
        </p>
        <p className="mt-2 text-brand">{body}</p>
        {action ? (
          <p className="mt-3">
            <TrackedLink
              href={action.href}
              event={action.event}
              props={{ position: action.position }}
              className="doc-link"
            >
              {action.label}
            </TrackedLink>
          </p>
        ) : null}
      </div>
    </div>
  );
}
