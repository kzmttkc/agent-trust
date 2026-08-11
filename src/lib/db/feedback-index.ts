import { and, eq, gte } from "drizzle-orm";
import type { FeedbackEntry } from "@/lib/chain/feedback-window";
import { getDb } from "./client";
import { getIndexerCheckpoint } from "./owner-index";
import { isMissingSchemaError } from "./pg-errors";
import { feedbackEvents } from "./schema";

/** Last block scanned for NewFeedback events. */
export const FEEDBACK_INDEX_CHECKPOINT = "reputation_registry_feedback";

/**
 * Where the indexer's first run started. Stored as its own checkpoint row
 * rather than a new column so `indexer_checkpoints` keeps the shape the owner
 * indexer already relies on.
 *
 * This is not bookkeeping — it is the guard that stops the index from being
 * read for a window it never covered. Without it, a 30-day question asked of
 * an 8-day index returns a confident, complete-looking undercount.
 */
export const FEEDBACK_COVERAGE_CHECKPOINT = "reputation_registry_feedback:start";

export type IndexedFeedbackWindow = {
  entries: FeedbackEntry[];
  /** Last block the indexer has scanned. Blocks after it are the live tail. */
  checkpoint: bigint;
  /** Earliest block the index reaches back to. */
  coverageStart: bigint;
};

/**
 * Read-only window lookup. Rows are populated by a trusted indexer — never by
 * API scoring.
 *
 * Returns null when the index cannot answer at all: no database, no
 * checkpoint yet, or the migration has not been applied to this database.
 * A null is not "no feedback" — the caller must fall back or degrade, never
 * report zeros.
 */
export async function getIndexedFeedbackWindow(
  chainId: number,
  agentId: bigint,
  fromBlock: bigint,
): Promise<IndexedFeedbackWindow | null> {
  const db = getDb();
  if (!db) return null;

  const [checkpoint, coverageStart] = await Promise.all([
    getIndexerCheckpoint(FEEDBACK_INDEX_CHECKPOINT),
    getIndexerCheckpoint(FEEDBACK_COVERAGE_CHECKPOINT),
  ]);

  if (checkpoint === null || coverageStart === null) return null;

  try {
    const rows = await db
      .select({
        clientAddress: feedbackEvents.clientAddress,
        blockNumber: feedbackEvents.blockNumber,
        txHash: feedbackEvents.txHash,
        logIndex: feedbackEvents.logIndex,
      })
      .from(feedbackEvents)
      .where(
        and(
          eq(feedbackEvents.chainId, chainId),
          eq(feedbackEvents.agentId, agentId),
          gte(feedbackEvents.blockNumber, fromBlock),
        ),
      );

    return { entries: rows, checkpoint, coverageStart };
  } catch (error) {
    // Migration not applied on this database yet — degrade to the caller's
    // fallback rather than crashing the score. Same contract as every other
    // reader added after the initial schema.
    if (isMissingSchemaError(error)) return null;
    throw error;
  }
}

export type FeedbackIndexerStatus = {
  scope: string;
  lastBlock: bigint | null;
  coverageStart: bigint | null;
  blocksBehind: bigint | null;
};

/** Freshness view for health checks and the indexer's own logging. */
export async function getFeedbackIndexerStatus(options?: {
  liveTip?: bigint;
}): Promise<FeedbackIndexerStatus | null> {
  const [lastBlock, coverageStart] = await Promise.all([
    getIndexerCheckpoint(FEEDBACK_INDEX_CHECKPOINT),
    getIndexerCheckpoint(FEEDBACK_COVERAGE_CHECKPOINT),
  ]);

  if (lastBlock === null) return null;

  return {
    scope: FEEDBACK_INDEX_CHECKPOINT,
    lastBlock,
    coverageStart,
    blocksBehind: options?.liveTip !== undefined ? options.liveTip - lastBlock : null,
  };
}
