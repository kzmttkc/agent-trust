import { sql } from "drizzle-orm";
import { isProduction } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { ipRateLimits } from "@/lib/db/schema";

type Bucket = { count: number; resetAt: number };

const memoryBuckets = new Map<string, Bucket>();

// 2026-08-06 security (self-audit item 1): the key-less public paths
// (/api/v1/payees/verify, /api/badge/:address, /api/demo/score) previously
// either had no limit or returned a bare 429. A limiter the client cannot
// see is invisible to well-behaved integrators and useless as a documented
// contract, so the result now always carries enough to emit standard
// RateLimit-* headers — the caller learns the ceiling, what is left, and
// when the window resets, on EVERY response, not just the throttled one.
export type IpRateLimitResult = {
  allowed: boolean;
  /** Ceiling for this window. */
  limit: number;
  /** Requests still available in this window (0 when throttled). */
  remaining: number;
  /** Unix epoch seconds when the current window resets. */
  resetAt: number;
  /** Seconds until reset — only meaningful (and set) when throttled. */
  retryAfter?: number;
};

export async function consumeIpRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<IpRateLimitResult> {
  const db = getDb();
  if (db) {
    return consumeDbIpRateLimit(db, key, limit, windowMs);
  }

  if (isProduction()) {
    // Fail closed in production when the shared store is unreachable: better
    // to throttle everyone than to silently drop the only abuse barrier on a
    // key-less endpoint. Still emit a coherent window so headers stay valid.
    const resetAt = Math.ceil((Date.now() + windowMs) / 1000);
    return { allowed: false, limit, remaining: 0, resetAt, retryAfter: Math.ceil(windowMs / 1000) };
  }

  return consumeMemoryIpRateLimit(key, limit, windowMs);
}

async function consumeDbIpRateLimit(
  db: NonNullable<ReturnType<typeof getDb>>,
  key: string,
  limit: number,
  windowMs: number,
): Promise<IpRateLimitResult> {
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
  if (!row) {
    return { allowed: true, limit, remaining: limit - 1, resetAt: Math.ceil(resetAt.getTime() / 1000) };
  }

  const windowResetSec = Math.ceil(row.resetAt.getTime() / 1000);
  const remaining = Math.max(0, limit - row.count);

  if (row.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000));
    return { allowed: false, limit, remaining: 0, resetAt: windowResetSec, retryAfter };
  }

  return { allowed: true, limit, remaining, resetAt: windowResetSec };
}

function consumeMemoryIpRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): IpRateLimitResult {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    memoryBuckets.set(key, { count: 1, resetAt });
    return { allowed: true, limit, remaining: limit - 1, resetAt: Math.ceil(resetAt / 1000) };
  }

  const resetSec = Math.ceil(bucket.resetAt / 1000);
  if (bucket.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt: resetSec,
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, limit, remaining: Math.max(0, limit - bucket.count), resetAt: resetSec };
}

// Standard, client-visible rate-limit headers for the key-less paths. Uses the
// IETF draft `RateLimit-*` names (distinct from the authenticated path's
// `X-RateLimit-*` in rate-limit.ts, which reports monthly plan usage rather
// than a short IP window). `Retry-After` is only added on a throttle.
export function ipRateLimitHeaders(result: IpRateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(result.resetAt),
  };
  if (!result.allowed && result.retryAfter !== undefined) {
    headers["Retry-After"] = String(result.retryAfter);
  }
  return headers;
}

export { getClientIp } from "@/lib/api/client-ip";
