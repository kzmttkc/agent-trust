import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/pg-errors";
import { healthSnapshots } from "@/lib/db/schema";

export type HealthStatus = "ok" | "degraded" | "error";

const THROTTLE_MS = 5 * 60 * 1000;

/**
 * Pure decision: should a new row be written? Real traffic supplies the
 * sampling interval (see the table's own header comment for why there is no
 * cron), so this exists to keep an active site's table from growing one row
 * per request — a status change always writes immediately (an outage must
 * not wait up to 5 minutes to appear), otherwise at most once per THROTTLE_MS.
 */
export function shouldRecordSnapshot(params: {
  now: Date;
  lastSnapshot: { checkedAt: Date; status: string } | null;
  currentStatus: HealthStatus;
}): boolean {
  const { now, lastSnapshot, currentStatus } = params;
  if (!lastSnapshot) return true;
  if (lastSnapshot.status !== currentStatus) return true;
  return now.getTime() - lastSnapshot.checkedAt.getTime() >= THROTTLE_MS;
}

/** Fire-and-forget from GET /api/health. Never throws into the caller's response. */
export async function recordHealthSnapshotIfDue(status: HealthStatus): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const [last] = await db
      .select({ checkedAt: healthSnapshots.checkedAt, status: healthSnapshots.status })
      .from(healthSnapshots)
      .orderBy(desc(healthSnapshots.checkedAt))
      .limit(1);
    if (!shouldRecordSnapshot({ now: new Date(), lastSnapshot: last ?? null, currentStatus: status })) {
      return;
    }
    await db.insert(healthSnapshots).values({ status });
  } catch (error) {
    if (isMissingSchemaError(error)) return; // cold start — migration not applied yet
    throw error;
  }
}

export type DaySummary = {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  total: number;
  ok: number;
  degraded: number;
  error: number;
};

/**
 * Buckets snapshots into UTC calendar days. A day with zero rows is simply
 * absent from the result — never synthesized as 100% (or any other number).
 * /status must read "absent" as "not observed", not as "was fine".
 */
export function summarizeByDay(
  rows: readonly { checkedAt: Date; status: string }[],
): DaySummary[] {
  const byDay = new Map<string, DaySummary>();
  for (const row of rows) {
    const date = row.checkedAt.toISOString().slice(0, 10);
    let bucket = byDay.get(date);
    if (!bucket) {
      bucket = { date, total: 0, ok: 0, degraded: 0, error: 0 };
      byDay.set(date, bucket);
    }
    bucket.total += 1;
    if (row.status === "ok") bucket.ok += 1;
    else if (row.status === "degraded") bucket.degraded += 1;
    else if (row.status === "error") bucket.error += 1;
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type StatusHistory = {
  current: { status: HealthStatus; checkedAt: Date } | null;
  days: DaySummary[];
  /** Earliest row in the whole table (not just the queried window) — grounds "monitoring since". */
  monitoringSince: Date | null;
};

export async function getStatusHistory(windowDays = 30): Promise<StatusHistory> {
  const db = getDb();
  if (!db) return { current: null, days: [], monitoringSince: null };
  try {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ checkedAt: healthSnapshots.checkedAt, status: healthSnapshots.status })
      .from(healthSnapshots)
      .orderBy(desc(healthSnapshots.checkedAt));
    const current = rows[0] ? { status: rows[0].status as HealthStatus, checkedAt: rows[0].checkedAt } : null;
    const inWindow = rows.filter((r) => r.checkedAt >= cutoff);
    const monitoringSince = rows.length > 0 ? rows[rows.length - 1].checkedAt : null;
    return { current, days: summarizeByDay(inWindow), monitoringSince };
  } catch (error) {
    if (isMissingSchemaError(error)) return { current: null, days: [], monitoringSince: null };
    throw error;
  }
}
