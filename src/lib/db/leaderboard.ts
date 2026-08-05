import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { isMissingSchemaError } from "./pg-errors";

// N-17 (2026-08-05) — public leaderboard reader. Latest verdict per agent
// from trust_events, ALLOW first, score desc. Aggregate public-chain-derived
// data only; api_key attribution is never exposed.
export interface LeaderboardRow {
  agentId: string;
  trustScore: number;
  recommendation: string;
  scoredAt: string;
}

export async function fetchLeaderboard(limit = 25): Promise<LeaderboardRow[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db.execute(sql`
      SELECT DISTINCT ON (agent_id)
        agent_id, trust_score, recommendation, created_at
      FROM trust_events
      WHERE agent_id IS NOT NULL AND trust_score IS NOT NULL
      ORDER BY agent_id, created_at DESC
    `);
    const latest = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
    return (Array.isArray(latest) ? latest : [])
      .map((r) => ({
        agentId: String(r.agent_id),
        trustScore: Number(r.trust_score),
        recommendation: String(r.recommendation ?? ""),
        scoredAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }))
      .sort((a, b) => b.trustScore - a.trustScore)
      .slice(0, limit);
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    throw error;
  }
}
