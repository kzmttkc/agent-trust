import { sql } from "drizzle-orm";
import { isProduction } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { ipRateLimits } from "@/lib/db/schema";

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();

export async function consumeIpRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const db = getDb();
  if (db) {
    return consumeDbIpRateLimit(db, key, limit, windowMs);
  }

  if (isProduction()) {
    return { allowed: false, retryAfter: 60 };
  }

  return consumeMemoryIpRateLimit(key, limit, windowMs);
}

async function consumeDbIpRateLimit(
  db: NonNullable<ReturnType<typeof getDb>>,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const nowIso = now.toISOString();
  const resetAtIso = resetAt.toISOString();

  const updated = await db
    .insert(ipRateLimits)
    .values({ bucketKey: key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: ipRateLimits.bucketKey,
      set: {
        count: sql`CASE WHEN ${ipRateLimits.resetAt} <= ${nowIso} THEN 1 ELSE ${ipRateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${ipRateLimits.resetAt} <= ${nowIso} THEN ${resetAtIso} ELSE ${ipRateLimits.resetAt} END`,
      },
    })
    .returning();

  const row = updated[0];
  if (!row) return { allowed: true };

  if (row.count > limit) {
    const retryAfter = Math.max(
      1,
      Math.ceil((row.resetAt.getTime() - Date.now()) / 1000),
    );
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

function consumeMemoryIpRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true };
}

export { getClientIp } from "@/lib/api/client-ip";
