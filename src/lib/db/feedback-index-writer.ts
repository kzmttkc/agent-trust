import { and, eq, lt } from "drizzle-orm";
import { getDb } from "./client";
import { feedbackEvents } from "./schema";
import { isMissingSchemaError } from "./pg-errors";

/** One NewFeedback log, flattened for insertion. */
export type FeedbackEventRow = {
  chainId: number;
  agentId: bigint;
  clientAddress: string;
  blockNumber: bigint;
  logIndex: number;
  txHash: string;
};

const INSERT_BATCH = 500;

/**
 * Trusted indexer write path — never called from API scoring.
 *
 * Returns the number of rows newly inserted. Conflicts are ignored rather than
 * updated: a NewFeedback log is immutable, so a row that already exists is the
 * same row, and re-scanning a range must be a no-op.
 */
export async function recordFeedbackEvents(rows: readonly FeedbackEventRow[]): Promise<number> {
  const db = getDb();
  if (!db || rows.length === 0) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH).map((row) => ({
      ...row,
      clientAddress: row.clientAddress.toLowerCase(),
      txHash: row.txHash.toLowerCase(),
    }));

    const result = await db
      .insert(feedbackEvents)
      .values(batch)
      .onConflictDoNothing()
      .returning();

    inserted += result.length;
  }

  return inserted;
}

/**
 * Drop rows that have fallen out of the retention window. Keeps the table
 * bounded; the coverage checkpoint is moved forward by the caller in the same
 * run so a reader can never believe in rows that were just pruned.
 */
export async function pruneFeedbackEvents(
  chainId: number,
  beforeBlock: bigint,
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const deleted = await db
      .delete(feedbackEvents)
      .where(
        and(
          eq(feedbackEvents.chainId, chainId),
          lt(feedbackEvents.blockNumber, beforeBlock),
        ),
      )
      .returning();
    return deleted.length;
  } catch (error) {
    if (isMissingSchemaError(error)) return 0;
    throw error;
  }
}
