import { and, eq, sql } from "drizzle-orm";
import { isProduction } from "@/lib/config/env";
import { getPlanLimit } from "./auth";
import { getApiKeyById } from "@/lib/db/api-keys";
import { getDb } from "@/lib/db/client";
import { apiUsage, ownerUsage } from "@/lib/db/schema";

export type RateLimitResult = {
  allowed: boolean;
  usage: number;
  limit: number;
  retryAfter?: number;
};

const memoryOwnerUsage = new Map<string, { period: string; count: number }>();

export function currentUsagePeriod(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

export function secondsUntilNextMonth(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

export async function consumeRateLimit(
  apiKeyId: string,
  plan: string,
  units = 1,
): Promise<RateLimitResult> {
  const limit = getPlanLimit(plan);
  const period = currentUsagePeriod();

  if (units > limit) {
    return {
      allowed: false,
      usage: 0,
      limit,
      retryAfter: secondsUntilNextMonth(),
    };
  }

  const db = getDb();
  if (!db) {
    if (isProduction()) {
      return {
        allowed: false,
        usage: 0,
        limit,
        retryAfter: secondsUntilNextMonth(),
      };
    }
    return consumeMemoryOwnerRateLimit(apiKeyId, period, limit, units);
  }

  if (apiKeyId === "dev") {
    return consumeMemoryOwnerRateLimit(apiKeyId, period, limit, units);
  }

  const key = await getApiKeyById(apiKeyId);
  const userId = key?.userId ?? apiKeyId;

  const ownerResult = await consumeOwnerRateLimitDb(userId, period, limit, units);
  if (!ownerResult.allowed) {
    return ownerResult;
  }

  await db
    .insert(apiUsage)
    .values({ apiKeyId, period, count: units })
    .onConflictDoUpdate({
      target: [apiUsage.apiKeyId, apiUsage.period],
      set: { count: sql`${apiUsage.count} + ${units}` },
    });

  return ownerResult;
}

async function consumeOwnerRateLimitDb(
  userId: string,
  period: string,
  limit: number,
  units: number,
): Promise<RateLimitResult> {
  const db = getDb()!;

  const updated = await db
    .insert(ownerUsage)
    .values({ userId, period, count: units })
    .onConflictDoUpdate({
      target: [ownerUsage.userId, ownerUsage.period],
      set: { count: sql`${ownerUsage.count} + ${units}` },
      setWhere: sql`${ownerUsage.count} + ${units} <= ${limit}`,
    })
    .returning();

  if (updated[0]) {
    return { allowed: true, usage: updated[0].count, limit };
  }

  const current = await db
    .select({ count: ownerUsage.count })
    .from(ownerUsage)
    .where(and(eq(ownerUsage.userId, userId), eq(ownerUsage.period, period)))
    .limit(1);

  return {
    allowed: false,
    usage: current[0]?.count ?? 0,
    limit,
    retryAfter: secondsUntilNextMonth(),
  };
}

function consumeMemoryOwnerRateLimit(
  userId: string,
  period: string,
  limit: number,
  units: number,
): RateLimitResult {
  const key = `${userId}:${period}`;
  const existing = memoryOwnerUsage.get(key);
  const current = existing?.period === period ? existing.count : 0;

  if (current + units > limit) {
    return {
      allowed: false,
      usage: current,
      limit,
      retryAfter: secondsUntilNextMonth(),
    };
  }

  const nextCount = current + units;
  memoryOwnerUsage.set(key, { period, count: nextCount });
  return { allowed: true, usage: nextCount, limit };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const remaining = Math.max(0, result.limit - result.usage);
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Used": String(result.usage),
    "X-RateLimit-Remaining": String(remaining),
  };
}
