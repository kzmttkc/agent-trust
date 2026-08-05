import { and, eq, gte } from "drizzle-orm";
import { getDb } from "./client";
import { isMissingSchemaError } from "./pg-errors";
import { trustEvents, verdictOutcomes } from "./schema";
import { logServerError } from "@/lib/util/log";
import type { AccuracyRow } from "@/lib/scoring/accuracy";

/**
 * The read side of verdict_outcomes (2026-08-05 R&D).
 *
 * Joins each outcome to the verdict it judges, so the accuracy module can
 * answer "of the ALLOWs we issued, how many later went bad". Same defensive
 * posture as every other module touching post-launch tables: a missing table
 * or column degrades to an empty result and a log line, never a 500 — the
 * public /accuracy page has an honest empty state and must render even when
 * the database predates the migration.
 */
export async function fetchAccuracyRows(windowDays = 90): Promise<AccuracyRow[]> {
  const db = getDb();
  if (!db) return [];

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  try {
    const rows = await db
      .select({
        trustEventId: verdictOutcomes.trustEventId,
        recommendation: trustEvents.recommendation,
        outcomeType: verdictOutcomes.outcomeType,
        source: verdictOutcomes.source,
        detectedAt: verdictOutcomes.detectedAt,
      })
      .from(verdictOutcomes)
      .innerJoin(trustEvents, eq(trustEvents.id, verdictOutcomes.trustEventId))
      .where(and(gte(verdictOutcomes.detectedAt, since)))
      .limit(50_000);

    return rows.map((r) => ({
      trustEventId: r.trustEventId,
      recommendation: r.recommendation,
      outcomeType: r.outcomeType,
      source: r.source,
      detectedAt: r.detectedAt,
    }));
  } catch (error) {
    if (isMissingSchemaError(error)) {
      // Table not migrated yet — the page's empty state covers this.
      return [];
    }
    logServerError("accuracy_rows_fetch", error);
    return [];
  }
}
