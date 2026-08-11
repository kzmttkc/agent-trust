/**
 * Pure window arithmetic for the NewFeedback signal (2026-08-12).
 *
 * WHY THIS FILE EXISTS. `fetchRecentFeedbackStats` now assembles its answer
 * from two sources — indexed rows in Postgres plus a short live scan of the
 * blocks the indexer has not reached yet. The rules that decide *which* rows
 * count, *whether* the index may be trusted, and *whether* the live tail is
 * affordable are the entire correctness argument for that change, and none of
 * them need a database or an RPC endpoint to evaluate. They live here so they
 * can be tested directly, the way verdict.ts was split out of sybil.ts for the
 * same reason.
 *
 * The invariant every function here protects: this signal may be reported only
 * when the sources together cover the WHOLE window. A partially covered window
 * undercounts, and an undercount is fail-OPEN — `review_velocity_anomaly` is
 * raised by feedback being *plentiful*, so missing rows can only make a sybil
 * cluster look quieter than it is. When coverage cannot be proven, the caller
 * must raise `feedback_stats_unavailable` and let the existing fail-closed
 * chain do its job.
 */

export type RecentFeedbackStats = {
  recentCount: number;
  uniqueClients: number;
  windowDays: number;
};

/** One NewFeedback occurrence, from either source. */
export type FeedbackEntry = {
  clientAddress: string | null | undefined;
  blockNumber: bigint | null | undefined;
  txHash: string | null | undefined;
  logIndex: number | null | undefined;
};

/**
 * Days of tail the live scan is allowed to cover.
 *
 * Vercel Hobby crons run once a day with ±59 minutes of scheduling slack, so
 * the index can legitimately sit ~25 hours behind the tip. Two days leaves
 * room for that plus a missed run. Beyond it the gap stops being a "tail" —
 * it is the wide scan this change exists to delete — so the caller degrades
 * instead of scanning.
 */
export const FEEDBACK_TAIL_MAX_DAYS = 2;

/**
 * How far back the indexer reaches on its very first run.
 *
 * Not the registry's deployment block: that is millions of blocks behind the
 * tip, would not finish inside the 300s function budget, and — because a
 * checkpointed scan advances forward — would deliver the OLDEST blocks first,
 * leaving the "last 7 days" this signal actually needs until the very end.
 * Starting 8 days back means one run makes the scoring window whole.
 */
export const FEEDBACK_BOOTSTRAP_DAYS = 8;

/**
 * Rows older than this are dropped after each indexer run. Bounds the table
 * and, once reached, fixes coverage at a stable 35 days — enough for the
 * outcome-detector's widest window (30 days) with room to spare.
 */
export const FEEDBACK_RETENTION_DAYS = 35;

function blocksFor(days: number, blocksPerDay: number): bigint {
  return BigInt(Math.ceil(days * blocksPerDay));
}

/**
 * First block of the "recent" window — deliberately identical to the
 * expression the chain scan used, so the signal's meaning does not move:
 * `latestBlock - blocksPerDay * windowDays`, floored at the registry's own
 * first block.
 */
export function feedbackWindowFromBlock(
  latestBlock: bigint,
  windowDays: number,
  blocksPerDay: number,
  floorBlock: bigint,
): bigint {
  const span = blocksFor(windowDays, blocksPerDay);
  return latestBlock > span ? latestBlock - span : floorBlock;
}

export function tailMaxBlocks(blocksPerDay: number): bigint {
  return blocksFor(FEEDBACK_TAIL_MAX_DAYS, blocksPerDay);
}

export function bootstrapBlocks(blocksPerDay: number): bigint {
  return blocksFor(FEEDBACK_BOOTSTRAP_DAYS, blocksPerDay);
}

export function retentionBlocks(blocksPerDay: number): bigint {
  return blocksFor(FEEDBACK_RETENTION_DAYS, blocksPerDay);
}

/**
 * Does the index reach back far enough to answer this window?
 *
 * `coverageStart` is where the indexer's very first run began. Anything before
 * it was never scanned, so a window that opens earlier would be answered from
 * rows that are missing by construction — an undercount wearing the face of a
 * complete answer.
 */
export function indexCoversWindow(coverageStart: bigint, windowFromBlock: bigint): boolean {
  return coverageStart <= windowFromBlock;
}

/**
 * Is the unindexed tail short enough to read live?
 *
 * A zero or negative gap means the index is already at (or past) the tip and
 * no scan is needed at all.
 */
export function tailScanFits(gap: bigint, maxBlocks: bigint): boolean {
  return gap <= maxBlocks;
}

/**
 * Collapse entries from both sources into the stats the sybil rules consume.
 *
 * Deduplicates on (txHash, logIndex) because the indexed range and the live
 * tail can overlap: the checkpoint advances between the DB read and the tip
 * read, and a chunk replayed after a partial indexer run can land twice.
 * Double-counting would inflate `recentCount` and manufacture
 * `review_velocity_anomaly` on honest agents.
 *
 * Entries below `fromBlock` are dropped here rather than trusted to the query,
 * so the live tail obeys exactly the same window boundary as the DB rows.
 */
export function summarizeFeedback(
  entries: readonly FeedbackEntry[],
  fromBlock: bigint,
  windowDays: number,
): RecentFeedbackStats {
  const seen = new Set<string>();
  const clients = new Set<string>();
  let recentCount = 0;

  for (const entry of entries) {
    if (entry.blockNumber === null || entry.blockNumber === undefined) continue;
    if (entry.blockNumber < fromBlock) continue;

    const key = `${(entry.txHash ?? "").toLowerCase()}:${entry.logIndex ?? -1}`;
    if (seen.has(key)) continue;
    seen.add(key);

    recentCount++;
    if (entry.clientAddress) {
      clients.add(entry.clientAddress.toLowerCase());
    }
  }

  return { recentCount, uniqueClients: clients.size, windowDays };
}
