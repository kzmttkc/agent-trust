import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agentPassports } from "@/lib/db/schema";
import { parseAgentId } from "@/lib/chain/client";
import { scoreAgentById } from "@/lib/scoring/engine";
import TrackView from "@/components/site/TrackView";

// A-10 — public agent passport profile: the symmetric twin of the payee
// profile (/payee/[address]). Where a payee proves control of a receiving
// wallet, an agent proves control of its ERC-8004 identity. The agent presents
// this proactively to win better terms; a counterparty reads it to decide.
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ agentId: string }>;
}): Promise<Metadata> {
  const { agentId } = await params;
  return {
    title: `Agent ${agentId} — trust passport | Vouch`,
    description: "Verified AI agent: signature-proven identity claim plus a live trust score and x402 payment record.",
  };
}

export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId: agentIdParam } = await params;
  const agentId = parseAgentId(agentIdParam);
  if (agentId === null) notFound();

  const db = getDb();
  let entry: { name: string; url: string | null; wallet: string; verifiedAt: Date | null } | null = null;
  if (db) {
    try {
      const rows = await db
        .select()
        .from(agentPassports)
        .where(eq(agentPassports.agentId, agentId))
        .limit(1);
      if (rows[0]) {
        entry = { name: rows[0].name, url: rows[0].url, wallet: rows[0].wallet, verifiedAt: rows[0].verifiedAt };
      }
    } catch {
      entry = null;
    }
  }

  let score:
    | { value: number; recommendation: string; paymentCount: number; uniqueDays: number }
    | null = null;
  try {
    // 2026-08-06: scoreAgentById reads chain state several calls deep. A HANG
    // in that await chain (a slow/unreachable RPC) is not a rejection, so the
    // catch below never fires and the whole page hangs until Vercel kills it
    // with a 504 — reproduced 504 on /agent/1 in production, the same failure
    // class already fixed in /api/demo/score. Race the score against a timeout
    // well under the platform limit so an unresponsive dependency degrades to
    // "Score unavailable right now." instead of taking the page down.
    const result = await Promise.race([
      scoreAgentById(agentId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("agent_score_timeout")), 8_000),
      ),
    ]);
    score = {
      value: result.trustScore,
      recommendation: result.recommendation,
      paymentCount: result.signals.x402.paymentCount,
      uniqueDays: result.signals.x402.uniqueDays,
    };
  } catch {
    score = null;
  }

  // Coarse band for the passport_view event — map the product's own
  // ALLOW/WARN/BLOCK banding rather than invent numeric thresholds. The
  // agentId is deliberately NOT a prop (the URL path already carries it).
  const band = !score
    ? "unavailable"
    : score.recommendation === "ALLOW"
      ? "high"
      : score.recommendation === "WARN"
        ? "medium"
        : score.recommendation === "BLOCK"
          ? "low"
          : "unknown";

  return (
    <main className="mx-auto max-w-2xl px-5 py-16 md:px-8">
      <TrackView event="passport_view" props={{ band, verified: Boolean(entry) }} withReferrerType />
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {entry ? "Verified agent" : "Agent"}
      </p>
      <h1 className="mt-2 font-mono text-2xl font-semibold text-zinc-900">Agent #{agentId.toString()}</h1>

      {entry ? (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="font-semibold text-emerald-900">{entry.name}</p>
          <p className="mt-1 text-sm text-emerald-800">
            Control of this agent was proven by a signature from its on-chain wallet
            {entry.verifiedAt ? ` on ${entry.verifiedAt.toISOString().slice(0, 10)}` : ""}.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-emerald-800">{entry.wallet}</p>
          {entry.url ? (
            <p className="mt-1 text-sm text-emerald-800">
              Site:{" "}
              <a href={entry.url} rel="noopener noreferrer nofollow" target="_blank" className="underline">
                {entry.url}
              </a>
            </p>
          ) : null}
          <p className="mt-2 text-xs text-emerald-700">
            Verification proves wallet control only — it is not an endorsement, and the score below is
            computed independently of it.
          </p>
        </div>
      ) : (
        <p className="mt-6 text-zinc-600">
          This agent has not registered a trust passport.{" "}
          <span className="text-zinc-500">
            Own it? POST a signed claim to{" "}
            <code className="rounded bg-zinc-100 px-1">/api/v1/agents/verify</code> — free, no API key,
            signature required.
          </span>
        </p>
      )}

      <div className="mt-8 rounded-xl border border-zinc-200 p-5">
        <p className="text-sm text-zinc-500">Live trust score</p>
        {score ? (
          <p className="mt-1 text-3xl font-semibold text-zinc-900">
            <span
              role="img"
              aria-label={`Trust score ${score.value} out of 100, recommendation ${score.recommendation}`}
            >
              {score.value} <span className="text-base font-mono">{score.recommendation}</span>
            </span>
          </p>
        ) : (
          <p className="mt-1 text-zinc-500">Score unavailable right now.</p>
        )}
        {score ? (
          <p className="mt-2 text-xs text-zinc-500">
            x402 settlement record: {score.paymentCount} payment{score.paymentCount === 1 ? "" : "s"} over{" "}
            {score.uniqueDays} distinct day{score.uniqueDays === 1 ? "" : "s"}.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-zinc-500">
          <Link href="/accuracy" className="underline">Methodology and measured accuracy</Link>.{" "}
          Machine-readable passport:{" "}
          <code className="break-all rounded bg-zinc-100 px-1">/api/v1/agents/{agentId.toString()}/passport</code>.{" "}
          Badge for your site:{" "}
          <code className="break-all rounded bg-zinc-100 px-1">/api/badge/agent/{agentId.toString()}</code>
        </p>
      </div>
    </main>
  );
}
