import { lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dashboardSessions, ipRateLimits } from "@/lib/db/schema";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const LOG_RETENTION_DAYS = {
  free: 90,
  pro: 365,
  scale: 365,
} as const;

export type PurgeLogsResult = {
  trustEventsDeleted: number;
  sessionsDeleted: number;
  rateLimitsDeleted: number;
};

function cutoffDate(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

export async function purgeExpiredLogs(): Promise<PurgeLogsResult> {
  const db = getDb();
  if (!db) {
    throw new Error("DATABASE_URL is not configured");
  }

  const freeCutoff = cutoffDate(LOG_RETENTION_DAYS.free).toISOString();
  const paidCutoff = cutoffDate(LOG_RETENTION_DAYS.pro).toISOString();
  const now = new Date();

  const [freeDeleted, paidDeleted, sessionsDeleted, rateLimitsDeleted] = await Promise.all([
    db.execute(sql`
      DELETE FROM trust_events te
      USING api_keys ak
      WHERE te.api_key_id = ak.id
        AND ak.plan = 'free'
        AND te.created_at < ${freeCutoff}
    `),
    db.execute(sql`
      DELETE FROM trust_events te
      USING api_keys ak
      WHERE te.api_key_id = ak.id
        AND ak.plan IN ('pro', 'scale')
        AND te.created_at < ${paidCutoff}
    `),
    db.delete(dashboardSessions).where(lt(dashboardSessions.expiresAt, now)).returning(),
    db.delete(ipRateLimits).where(lt(ipRateLimits.resetAt, now)).returning(),
  ]);

  return {
    trustEventsDeleted: sqlDeleteCount(freeDeleted) + sqlDeleteCount(paidDeleted),
    sessionsDeleted: sessionsDeleted.length,
    rateLimitsDeleted: rateLimitsDeleted.length,
  };
}

function sqlDeleteCount(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const meta = result as { rowCount?: number; count?: number };
  return Number(meta.rowCount ?? meta.count ?? 0);
}
