import { and, desc, eq, gte, inArray, isNotNull, notInArray } from "drizzle-orm";
import { getDb } from "./client";
import { trustEvents, verdictOutcomes } from "./schema";

export type AutoOutcomeType =
  | "rug_pull_outflow"
  | "wallet_dormant"
  | "sustained_healthy_activity"
  | "ownership_changed"
  | "reputation_negative_feedback";

export type PartnerOutcomeType =
  | "confirmed_fraud"
  | "confirmed_legitimate"
  | "chargeback_dispute"
  | "other";

/**
 * outcome_type values that are mutually-exclusive terminal verdicts about a
 * wallet's post-score activity. Once one of these is recorded (source=auto)
 * for a trust_event, the outcome-detector stops re-scanning that wallet's
 * transaction history — it has reached a conclusion. ownership_changed and
 * reputation_negative_feedback are independent side-signals and don't gate
 * re-scanning on their own.
 */
export const TERMINAL_ACTIVITY_OUTCOME_TYPES: AutoOutcomeType[] = [
  "rug_pull_outflow",
  "wallet_dormant",
  "sustained_healthy_activity",
];

export type TrustEventRow = {
  id: string;
  agentId: bigint | null;
  wallet: string | null;
  createdAt: Date;
  signals: unknown;
};

/**
 * verdict_outcomes is a new table (see scripts/sql/2026-07-14-verdict-outcomes.sql).
 * DATABASE_URL is a Vercel "sensitive" env var that CLI tooling can't read to
 * apply migrations by hand, so every read/write here must degrade to a
 * silent no-op (log only) rather than throw when the table isn't there yet —
 * same discipline as funder_index_skips (src/lib/db/funder-index-writer.ts).
 */

/** Trust events created within the last N days that still need outcome scanning. */
export async function collectWatchedTrustEvents(
  windowDays: number,
  limit: number,
): Promise<TrustEventRow[]> {
  const db = getDb();
  if (!db) return [];

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  try {
    const alreadyTerminal = db
      .select({ trustEventId: verdictOutcomes.trustEventId })
      .from(verdictOutcomes)
      .where(
        and(
          eq(verdictOutcomes.source, "auto"),
          inArray(verdictOutcomes.outcomeType, TERMINAL_ACTIVITY_OUTCOME_TYPES),
        ),
      );

    const rows = await db
      .select({
        id: trustEvents.id,
        agentId: trustEvents.agentId,
        wallet: trustEvents.wallet,
        createdAt: trustEvents.createdAt,
        signals: trustEvents.signals,
      })
      .from(trustEvents)
      .where(
        and(
          gte(trustEvents.createdAt, since),
          isNotNull(trustEvents.wallet),
          notInArray(trustEvents.id, alreadyTerminal),
        ),
      )
      .orderBy(desc(trustEvents.createdAt))
      .limit(limit);

    return rows
      .filter((row): row is typeof row & { createdAt: Date } => row.createdAt !== null)
      .map((row) => ({
        id: row.id,
        agentId: row.agentId,
        wallet: row.wallet,
        createdAt: row.createdAt,
        signals: row.signals,
      }));
  } catch (err) {
    console.error(
      "outcome-writer: collectWatchedTrustEvents failed, degrading to no-op (verdict_outcomes likely not migrated yet)",
      err,
    );
    return [];
  }
}

/** Auto-detected outcome. Idempotent via unique(trust_event_id, outcome_type, source). */
export async function recordAutoOutcome(input: {
  trustEventId: string;
  outcomeType: AutoOutcomeType;
  relatedWallet?: string | null;
  windowMinutes: number;
  evidence?: unknown;
}): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  try {
    const inserted = await db
      .insert(verdictOutcomes)
      .values({
        trustEventId: input.trustEventId,
        outcomeType: input.outcomeType,
        relatedWallet: input.relatedWallet ?? null,
        windowMinutes: input.windowMinutes,
        source: "auto",
        evidence: input.evidence ?? null,
      })
      .onConflictDoNothing()
      .returning();

    return inserted.length > 0;
  } catch (err) {
    console.error("outcome-writer: recordAutoOutcome failed, skipping write", err);
    return false;
  }
}

/**
 * Reads from trust_events — a stable, pre-existing table, not the new
 * verdict_outcomes one — so unlike the functions above this intentionally
 * lets a real DB failure propagate instead of degrading to null. Callers
 * must not conflate "genuinely not found" with "lookup failed".
 */
export async function getTrustEventById(trustEventId: string): Promise<TrustEventRow | null> {
  const db = getDb();
  if (!db) throw new Error("database_unavailable");

  const rows = await db
    .select({
      id: trustEvents.id,
      agentId: trustEvents.agentId,
      wallet: trustEvents.wallet,
      createdAt: trustEvents.createdAt,
      signals: trustEvents.signals,
    })
    .from(trustEvents)
    .where(eq(trustEvents.id, trustEventId))
    .limit(1);

  const row = rows[0];
  if (!row || !row.createdAt) return null;

  return {
    id: row.id,
    agentId: row.agentId,
    wallet: row.wallet,
    createdAt: row.createdAt,
    signals: row.signals,
  };
}

export type RecordPartnerOutcomeInput = {
  trustEventId: string;
  outcomeType: PartnerOutcomeType;
  relatedWallet?: string | null;
  windowMinutes: number;
  apiKeyId: string;
  evidence?: unknown;
};

/**
 * Idempotent on (trust_event_id, outcome_type, source). A second report of
 * the same type from the same partner key returns the existing row instead
 * of erroring, mirroring recordX402Payment's idempotent-insert pattern.
 */
export async function recordPartnerOutcome(
  input: RecordPartnerOutcomeInput,
): Promise<{ created: boolean; id: string } | null> {
  const db = getDb();
  if (!db) return null;

  const source = `partner:${input.apiKeyId}`;

  try {
    const existing = await db
      .select({ id: verdictOutcomes.id })
      .from(verdictOutcomes)
      .where(
        and(
          eq(verdictOutcomes.trustEventId, input.trustEventId),
          eq(verdictOutcomes.outcomeType, input.outcomeType),
          eq(verdictOutcomes.source, source),
        ),
      )
      .limit(1);

    if (existing[0]) {
      return { created: false, id: existing[0].id };
    }

    const inserted = await db
      .insert(verdictOutcomes)
      .values({
        trustEventId: input.trustEventId,
        outcomeType: input.outcomeType,
        relatedWallet: input.relatedWallet ?? null,
        windowMinutes: input.windowMinutes,
        source,
        apiKeyId: input.apiKeyId,
        evidence: input.evidence ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return { created: true, id: inserted[0].id };
    }

    // Lost a race with a concurrent identical report — re-read.
    const raced = await db
      .select({ id: verdictOutcomes.id })
      .from(verdictOutcomes)
      .where(
        and(
          eq(verdictOutcomes.trustEventId, input.trustEventId),
          eq(verdictOutcomes.outcomeType, input.outcomeType),
          eq(verdictOutcomes.source, source),
        ),
      )
      .limit(1);

    return raced[0] ? { created: false, id: raced[0].id } : null;
  } catch (err) {
    console.error("outcome-writer: recordPartnerOutcome failed", err);
    throw err;
  }
}
