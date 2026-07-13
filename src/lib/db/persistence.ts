import { desc, eq, and } from "drizzle-orm";
import { getDb } from "./client";
import { trustEvents } from "./schema";
import { getDataCoverage } from "@/lib/health/data-coverage";
import type { TrustScoreResult } from "@/lib/scoring/types";

export async function persistScoreResult(
  apiKeyId: string,
  result: TrustScoreResult,
): Promise<void> {
  const db = getDb();
  if (!db || apiKeyId === "dev") return;

  const agentId =
    result.agentId === "0" ? null : BigInt(result.agentId);

  await db.insert(trustEvents).values({
    apiKeyId,
    agentId,
    wallet: result.wallet,
    trustScore: result.trustScore,
    recommendation: result.recommendation,
    signals: result.signals,
    manualOverride: result.manualOverride ? "true" : "false",
    blockReason: result.blockReason ?? null,
    disclaimer: result.disclaimer,
    cacheExpiresAt: new Date(result.cacheExpiresAt),
  });
}

export async function getScoreHistory(
  apiKeyId: string,
  agentId: bigint,
  limit: number,
): Promise<TrustScoreResult[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(trustEvents)
    .where(and(eq(trustEvents.apiKeyId, apiKeyId), eq(trustEvents.agentId, agentId)))
    .orderBy(desc(trustEvents.createdAt))
    .limit(limit);

  const dataCoverage = await getDataCoverage();

  return rows.map((row) => ({
    agentId: row.agentId?.toString() ?? "0",
    wallet: row.wallet,
    trustScore: row.trustScore ?? 0,
    recommendation: (row.recommendation ?? "BLOCK") as TrustScoreResult["recommendation"],
    signals: (row.signals as TrustScoreResult["signals"]) ?? defaultSignals(),
    scoredAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    cacheExpiresAt:
      row.cacheExpiresAt?.toISOString() ??
      row.createdAt?.toISOString() ??
      new Date().toISOString(),
    disclaimer:
      row.disclaimer ??
      "Scores are informational only and do not constitute a guarantee, credit assessment, or investment advice.",
    blockReason: row.blockReason ?? undefined,
    manualOverride: row.manualOverride === "true",
    dataCoverage,
  }));
}

function defaultSignals(): TrustScoreResult["signals"] {
  return {
    identity: { registered: false, hasMetadataUri: false },
    reputation: { feedbackCount: 0, avgScore: 0, onChainAvgScore: 0 },
    wallet: { ageDays: 0, txCount: 0, isBurner: false },
    sybil: { risk: "low", flags: [] },
    manual: { list: "none" },
  };
}
