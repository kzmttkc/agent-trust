import { and, count, desc, eq } from "drizzle-orm";
import { getPlanLimit } from "@/lib/api/auth";
import { currentUsagePeriod } from "@/lib/api/rate-limit";
import { ensureOwnerUserId } from "@/lib/db/api-keys";
import { getDb } from "@/lib/db/client";
import { apiKeys, ownerUsage, trustEvents } from "@/lib/db/schema";
import { countX402PaymentsForApiKey } from "@/lib/db/x402-payments";

export async function getDashboardOverview(apiKeyId: string) {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  const period = currentUsagePeriod();
  const userId = await ensureOwnerUserId(apiKeyId);

  const [key, ownerUsageRows, recentEvents, settlementAttestations] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        plan: apiKeys.plan,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyId))
      .limit(1),
    db
      .select({ count: ownerUsage.count })
      .from(ownerUsage)
      .where(and(eq(ownerUsage.userId, userId), eq(ownerUsage.period, period)))
      .limit(1),
    db
      .select({ value: count() })
      .from(trustEvents)
      .where(eq(trustEvents.apiKeyId, apiKeyId)),
    countX402PaymentsForApiKey(apiKeyId),
  ]);

  const plan = key[0]?.plan ?? "free";
  const usage = ownerUsageRows[0]?.count ?? 0;
  const limit = getPlanLimit(plan);

  return {
    apiKey: key[0] ?? null,
    plan,
    usage: { period, count: usage, limit, remaining: Math.max(0, limit - usage) },
    totalQueries: recentEvents[0]?.value ?? 0,
    settlementAttestations,
  };
}

export async function getTrustEventLogs(apiKeyId: string, limit = 50) {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: trustEvents.id,
      agentId: trustEvents.agentId,
      wallet: trustEvents.wallet,
      trustScore: trustEvents.trustScore,
      recommendation: trustEvents.recommendation,
      createdAt: trustEvents.createdAt,
    })
    .from(trustEvents)
    .where(eq(trustEvents.apiKeyId, apiKeyId))
    .orderBy(desc(trustEvents.createdAt))
    .limit(limit);
}
