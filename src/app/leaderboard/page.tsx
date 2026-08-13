import type { Metadata } from "next";
import Link from "next/link";
import { VerdictBadge } from "@/components/site/VerdictBadge";
import { fetchLeaderboard } from "@/lib/db/leaderboard";

// N-17 — public agent leaderboard. Latest verdict per agent, aggregate only.
// Honest empty state, same discipline as /accuracy.
// 2026-08-13 vet402: typeset as a register of the memo.
export const metadata: Metadata = {
  title: "Register of recently verified subjects",
  description:
    "The highest-scoring ERC-8004 agents and wallets vet402 has recently verified: identity, reputation, wallet history and x402 settlement record, summarized as one score.",
};
export const revalidate = 600;

// Short 0x… form for wallet-keyed rows (benchmark seeds have no agent id).
function shortWallet(wallet: string | null): string {
  if (!wallet) return "—";
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

// Inline, honest marker for operator self-benchmark rows. Kept tiny so it
// annotates without competing with the real ranking data.
function SeedTag() {
  return <span className="marker marker-plan ml-2 align-middle">benchmark</span>;
}

export default async function LeaderboardPage() {
  let rows: Awaited<ReturnType<typeof fetchLeaderboard>> = [];
  try {
    rows = await fetchLeaderboard(25);
  } catch {
    rows = [];
  }
  const hasSeeded = rows.some((r) => r.seeded);

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Register: recently verified subjects</span>
            <span>
              {/* この頁のシアン1点。表に何行載っているかという事実。 */}
              Rows: <span className="text-signal">{rows.length} of 25</span>
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>Latest verdict per subject</span>
            <span>Aggregate only</span>
          </div>
        </div>

        <h1 className="doc-title mt-10">Recently verified subjects, ranked</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <div className="mt-8 flex flex-col gap-1 sm:flex-row sm:gap-0">
          <p className="shrink-0 text-brand-deep sm:w-[10ch]">Abstract</p>
          <p className="min-w-0 max-w-[62ch] text-brand">
            The latest verdict per subject, ranked by score. Every row is computed from public
            on-chain state &mdash; ERC-8004 identity and reputation, wallet history, x402
            settlements. Run the same lookup yourself with an API key.
          </p>
        </div>

        {/* 2026-08-06 UX audit item 6: distinguish operator self-benchmark rows
            from customer traffic, in plain sight, so the board can be full
            without ever implying usage it does not have. */}
        {hasSeeded ? (
          <p className="doc-note mt-6 max-w-[70ch]">
            Rows marked <SeedTag /> are operator benchmark entries &mdash; publicly known addresses
            we score ourselves to prove the engine is live and calibrated, not customer traffic. See
            the{" "}
            <Link href="/accuracy" className="doc-link">
              measured accuracy
            </Link>{" "}
            report for how they are used.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <div className="dashbox mt-10 max-w-[64ch]">
            <p className="doc-caption">Empty register</p>
            <p className="mt-3 text-brand">The board is warming up.</p>
            <p className="doc-note mt-3">
              No verdicts are in the current window yet. It will never be padded with fabricated
              agents &mdash; rows appear only as real lookups happen, and as our{" "}
              <Link href="/accuracy" className="doc-link">
                operator benchmark
              </Link>{" "}
              scores known addresses. Want to be the first real entry?{" "}
              <Link href="/signup" className="doc-link">
                Get an API key
              </Link>{" "}
              and run a lookup.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="fact-table">
              <caption className="sr-only">
                Recently verified subjects, ranked by trust score
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    #
                  </th>
                  <th scope="col">Subject</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col">Verdict</th>
                  <th scope="col" className="num">
                    Scored
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.identity}>
                    {/* 順位は表の意味を担う情報なので装飾扱いにしない。 */}
                    <td className="num text-brand-lift">{i + 1}</td>
                    {/* 2026-08-12 FIX-7: 行内に <a> が0個で、/agent/:id と
                        /payee/:address というプロフィールページが実在するのに一覧から
                        辿れず行き止まりだった。順位表の主キーである Subject を
                        その行の詳細へ繋ぐ。 */}
                    <td className="font-[family-name:var(--font-sans)] font-normal">
                      {r.agentId || r.wallet ? (
                        <Link
                          href={r.agentId ? `/agent/${r.agentId}` : `/payee/${r.wallet}`}
                          className="doc-link"
                        >
                          {r.agentId ? `Agent #${r.agentId}` : shortWallet(r.wallet)}
                        </Link>
                      ) : (
                        <span>{shortWallet(r.wallet)}</span>
                      )}
                      {r.seeded ? <SeedTag /> : null}
                    </td>
                    <td className="num text-brand-deep">{r.trustScore}</td>
                    <td>
                      <VerdictBadge verdict={r.recommendation} />
                    </td>
                    <td className="num whitespace-nowrap text-brand-lift">
                      {r.scoredAt.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 2026-08-06 a11y (WCAG 2.4.4): the link text was the bare path
            "/accuracy", which a screen reader's link list renders as "slash
            accuracy" with no indication of where it goes. */}
        <p className="mt-8 text-[0.8125rem]">
          <Link href="/accuracy" className="doc-link">
            Methodology and measured accuracy
          </Link>
          <span aria-hidden="true" className="mx-2 text-brand-lift">·</span>
          <Link href="/payee" className="doc-link">
            Verify a payee
          </Link>
        </p>
      </article>
    </main>
  );
}
