import type { Metadata } from "next";
import Link from "next/link";
import { fetchLeaderboard } from "@/lib/db/leaderboard";

// N-17 — public agent leaderboard. Latest verdict per agent, aggregate only.
// Honest empty state, same discipline as /accuracy.
export const metadata: Metadata = {
  title: "Agent leaderboard — highest-trust ERC-8004 agents | Vouch",
  description:
    "The highest-scoring ERC-8004 agents Vouch has recently verified: identity, reputation, wallet history and x402 settlement record, summarized as one score.",
};
export const revalidate = 600;

export default async function LeaderboardPage() {
  let rows: Awaited<ReturnType<typeof fetchLeaderboard>> = [];
  try {
    rows = await fetchLeaderboard(25);
  } catch {
    rows = [];
  }
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 md:px-8">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Leaderboard</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
        Recently verified agents, ranked
      </h1>
      <p className="mt-4 text-zinc-600">
        The latest verdict per agent, ranked by trust score. Every row is computed from public
        on-chain state (ERC-8004 identity and reputation, wallet history, x402 settlements) — run
        the same lookup yourself with an API key.
      </p>
      {rows.length === 0 ? (
        <p className="mt-10 text-zinc-500">
          No scored agents in the current window yet — the board fills in as lookups happen. It
          will not be seeded with synthetic entries.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-500">
                <th scope="col" className="py-2 pr-4 font-medium">#</th>
                <th scope="col" className="py-2 pr-4 font-medium">Agent ID</th>
                <th scope="col" className="py-2 pr-4 font-medium">Score</th>
                <th scope="col" className="py-2 pr-4 font-medium">Verdict</th>
                <th scope="col" className="py-2 font-medium">Scored</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.agentId} className="border-b border-zinc-100">
                  <td className="py-2 pr-4 text-zinc-400">{i + 1}</td>
                  <td className="py-2 pr-4 font-mono">{r.agentId}</td>
                  <td className="py-2 pr-4 font-semibold">{r.trustScore}</td>
                  <td className="py-2 pr-4 font-mono">{r.recommendation}</td>
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
