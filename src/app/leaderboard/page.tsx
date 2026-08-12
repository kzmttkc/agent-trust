import type { Metadata } from "next";
import Link from "next/link";
import { VerdictBadge } from "@/components/site/VerdictBadge";
import { fetchLeaderboard } from "@/lib/db/leaderboard";

// N-17 — public agent leaderboard. Latest verdict per agent, aggregate only.
// Honest empty state, same discipline as /accuracy.
export const metadata: Metadata = {
  title: "Agent leaderboard — highest-trust ERC-8004 agents | Vouch",
  description:
    "The highest-scoring ERC-8004 agents Vouch has recently verified: identity, reputation, wallet history and x402 settlement record, summarized as one score.",
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
  return (
    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-zinc-700">
      benchmark
    </span>
  );
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
    <main className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Leaderboard</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
        Recently verified agents, ranked
      </h1>
      <p className="mt-4 text-zinc-600">
        The latest verdict per subject, ranked by trust score. Every row is computed from public
        on-chain state (ERC-8004 identity and reputation, wallet history, x402 settlements) — run
        the same lookup yourself with an API key.
      </p>
      {/* 2026-08-06 UX audit item 6: distinguish operator self-benchmark rows
          from customer traffic, in plain sight, so the board can be full
          without ever implying usage it does not have. */}
      {hasSeeded ? (
        <p className="mt-3 text-sm text-zinc-500">
          Rows marked <SeedTag /> are operator benchmark entries — publicly known addresses we
          score ourselves to prove the engine is live and calibrated, not customer traffic. See the{" "}
          <Link href="/accuracy" className="underline">measured accuracy</Link> report for how they
          are used.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-zinc-200 bg-zinc-50 p-6">
          <p className="text-zinc-700">The board is warming up.</p>
          <p className="mt-2 text-sm text-zinc-500">
            No verdicts are in the current window yet. It will never be padded with fabricated
            agents — rows appear only as real lookups happen, and as our{" "}
            <Link href="/accuracy" className="underline">operator benchmark</Link> scores known
            addresses. Want to be the first real entry?{" "}
            <Link href="/signup" className="underline">Get an API key</Link> and run a lookup.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4 font-medium">#</th>
                <th scope="col" className="py-2 pr-4 font-medium">Subject</th>
                <th scope="col" className="py-2 pr-4 font-medium">Score</th>
                <th scope="col" className="py-2 pr-4 font-medium">Verdict</th>
                <th scope="col" className="py-2 font-medium">Scored</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.identity} className="border-b border-zinc-100">
                  {/* 順位は表の意味を担う情報なので装飾扱いにしない。
                      2026-08-12: zinc-400 は白地 2.62:1 で AA 不合格だった → zinc-500 (4.83:1)。 */}
                  <td className="py-2 pr-4 text-zinc-500">{i + 1}</td>
                  {/* 2026-08-12 FIX-7: 行内に <a> が0個で、/agent/:id と
                      /payee/:address というプロフィールページが実在するのに一覧から
                      辿れず行き止まりだった。順位表の主キーである Subject を
                      その行の詳細へ繋ぐ。 */}
                  <td className="py-2 pr-4">
                    {r.agentId || r.wallet ? (
                      <Link
                        href={r.agentId ? `/agent/${r.agentId}` : `/payee/${r.wallet}`}
                        className="font-mono underline underline-offset-2 hover:text-brand-deep"
                      >
                        {r.agentId ? `Agent #${r.agentId}` : shortWallet(r.wallet)}
                      </Link>
                    ) : (
                      <span className="font-mono">{shortWallet(r.wallet)}</span>
                    )}
                    {r.seeded ? <SeedTag /> : null}
                  </td>
                  <td className="py-2 pr-4 font-semibold">{r.trustScore}</td>
                  <td className="py-2 pr-4">
                    <VerdictBadge verdict={r.recommendation} />
                  </td>
                  <td className="py-2 text-zinc-500">{r.scoredAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* 2026-08-06 a11y (WCAG 2.4.4): the link text was the bare path
          "/accuracy", which a screen reader's link list renders as "slash
          accuracy" with no indication of where it goes. */}
      <p className="mt-8 text-sm text-zinc-600">
        <Link href="/accuracy" className="underline">Methodology and measured accuracy</Link>.
      </p>
    </main>
  );
}
