import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { isMissingSchemaError } from "./pg-errors";

// N-17 (2026-08-05) — public leaderboard reader. Latest verdict per subject
// from trust_events, ranked by score. Aggregate public-chain-derived data
// only; api_key attribution is never exposed.
//
// 2026-08-06 (UX audit item 6): the board was empty save one ~3-week-old row
// because the query required agent_id IS NOT NULL, but the operator benchmark
// (src/lib/benchmark) scores raw WALLETS whose agent_id is null — so every
// seeded verdict was silently filtered out. The board now keys on
// COALESCE(agent_id, wallet), so wallet-only benchmark rows surface, and each
// row carries a `seeded` flag + benchmark label so the UI can mark operator
// self-benchmark entries as exactly that — never dressed up as customer
// traffic. The benchmark writer is untouched; this is a read-side change only.
export interface LeaderboardRow {
  /** Stable per-subject key: agentId (as string) when present, else wallet. */
  identity: string;
  agentId: string | null;
  wallet: string | null;
  trustScore: number;
  recommendation: string;
  scoredAt: string;
  /** True when this row came from the operator benchmark (self-seeded). */
  seeded: boolean;
  /** 'good' | 'bad' for seeded rows (ground-truth label), else null. */
  benchmarkLabel: string | null;
}

export async function fetchLeaderboard(limit = 25): Promise<LeaderboardRow[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (COALESCE(agent_id::text, wallet))
        agent_id,
        wallet,
        trust_score,
        recommendation,
        created_at,
        signals->>'kind' AS kind,
        signals->'benchmark'->>'label' AS benchmark_label
      FROM trust_events
      WHERE trust_score IS NOT NULL
        AND COALESCE(agent_id::text, wallet) IS NOT NULL
      ORDER BY COALESCE(agent_id::text, wallet), created_at DESC
    `);
    const latest =
      (rows as unknown as { rows?: Record<string, unknown>[] }).rows ??
      (rows as unknown as Record<string, unknown>[]);
    return (Array.isArray(latest) ? latest : [])
      .map((r) => {
        const agentId = r.agent_id === null || r.agent_id === undefined ? null : String(r.agent_id);
        const wallet = r.wallet === null || r.wallet === undefined ? null : String(r.wallet);
        return {
          identity: agentId ?? wallet ?? "",
          agentId,
          wallet,
          trustScore: Number(r.trust_score),
          recommendation: String(r.recommendation ?? ""),
          scoredAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          seeded: r.kind === "benchmark_seed",
          benchmarkLabel:
            r.benchmark_label === null || r.benchmark_label === undefined
              ? null
              : String(r.benchmark_label),
        };
      })
      .sort((a, b) => b.trustScore - a.trustScore)
      .slice(0, limit);
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}
