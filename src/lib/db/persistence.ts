import { desc, eq, and } from "drizzle-orm";
import { getDb } from "./client";
import { trustEvents } from "./schema";
import { getDataCoverage } from "@/lib/health/data-coverage";
import type { PayeeScoreResult } from "@/lib/scoring/payee-engine";
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

/**
 * Records a payee (buyer-side) score query into the same trust_events ledger
 * the agent/wallet score routes use — no new table. Payee rows carry
 * `signals.kind = "payee_score"` (the signals column is already jsonb), which
 * does two jobs: collectWatchedTrustEvents (src/lib/db/outcome-writer.ts)
 * excludes these rows from the outcome-detector's seller-side watch set —
 * otherwise its drain classification would label payee wallets and feed those
 * verdicts back into payee scores — and ad-hoc usage measurement can filter
 * on it to count external buyer-side queries. `dataDepth` rides along inside
 * signals for the same reason.
 */
export async function persistPayeeScoreResult(
  apiKeyId: string,
  result: PayeeScoreResult,
): Promise<void> {
  const db = getDb();
  if (!db || apiKeyId === "dev") return;

  await db.insert(trustEvents).values({
    apiKeyId,
    agentId: null,
    wallet: result.payee,
    trustScore: result.score,
    recommendation: result.recommendation,
    signals: { kind: "payee_score", dataDepth: result.dataDepth, ...result.signals },
    manualOverride: "false",
    blockReason: null,
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

  const dataCoverage = await getDataCoverage(
    rows[0]?.wallet ?? undefined,
  );

  return rows.map((row) => ({
    agentId: row.agentId?.toString() ?? "0",
    wallet: row.wallet,
    trustScore: row.trustScore ?? 0,
    recommendation: (row.recommendation ?? "BLOCK") as TrustScoreResult["recommendation"],
    signals: normalizeSignals(row.signals as TrustScoreResult["signals"] | null),
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

function normalizeSignals(
  signals: TrustScoreResult["signals"] | null,
): TrustScoreResult["signals"] {
  const base = defaultSignals();
  if (!signals) return base;
  return {
    ...base,
    ...signals,
    x402: signals.x402 ?? base.x402,
  };
}

function defaultSignals(): TrustScoreResult["signals"] {
  return {
    identity: { registered: false, hasMetadataUri: false },
    reputation: { feedbackCount: 0, avgScore: 0, onChainAvgScore: 0 },
    wallet: { ageDays: 0, txCount: 0, isBurner: false },
    x402: { paymentCount: 0, uniqueDays: 0, score: 50 },
    sybil: { risk: "low", flags: [] },
    manual: { list: "none" },
  };
}
