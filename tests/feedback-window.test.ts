// ============================================================
// Vouch — the NewFeedback signal must keep its meaning after moving off-chain.
//
// WHY (2026-08-12). fetchRecentFeedbackStats used to scan a 7-day window with
// eth_getLogs on every uncached score: ~151 round-trips at the operator's
// configured chunk width, unfinishable inside a request budget. It always
// degraded to `feedback_stats_unavailable`, assessSybilRisk mapped that to
// high risk, and resolveRecommendation turned it into an unconditional BLOCK —
// so every agent on the site scored BLOCK regardless of merit.
//
// The answer now comes from an index plus a short live tail. That is only safe
// while two things hold, and both are asserted here:
//
//   1. The window is the SAME window. `recentCount` and `uniqueClients` feed
//      thresholds in sybil.ts (>=5 with <=2 clients, >=10 with <=3) that were
//      tuned against the chain scan. A quiet off-by-one in the block math
//      would retune a sybil rule without anyone editing the rule.
//
//   2. Partial coverage is never reported as an answer. Missing rows can only
//      make `recentCount` SMALLER, and this anomaly is raised by feedback
//      being plentiful — so an undercount is fail-OPEN. It hides exactly the
//      sybil cluster the signal exists to catch.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapBlocks,
  feedbackWindowFromBlock,
  indexCoversWindow,
  retentionBlocks,
  summarizeFeedback,
  tailMaxBlocks,
  tailScanFits,
  type FeedbackEntry,
} from "../src/lib/chain/feedback-window";

const BASE_BLOCKS_PER_DAY = 43_200;
const ETH_BLOCKS_PER_DAY = 7_200;
const FLOOR = 41_663_783n;

test("window start reproduces the chain scan's arithmetic exactly", () => {
  const tip = 50_000_000n;

  // The expression the scan used: latestBlock - blocksPerDay * windowDays.
  assert.equal(
    feedbackWindowFromBlock(tip, 7, BASE_BLOCKS_PER_DAY, FLOOR),
    tip - BigInt(7 * BASE_BLOCKS_PER_DAY),
  );
  assert.equal(feedbackWindowFromBlock(tip, 7, BASE_BLOCKS_PER_DAY, FLOOR), 49_697_600n);
});

test("window is chain-aware, not Base-shaped everywhere", () => {
  const tip = 50_000_000n;
  const base = feedbackWindowFromBlock(tip, 7, BASE_BLOCKS_PER_DAY, FLOOR);
  const eth = feedbackWindowFromBlock(tip, 7, ETH_BLOCKS_PER_DAY, FLOOR);

  // Ethereum's ~12s blocks mean 7 days is 6x fewer blocks. Using the Base
  // figure there would scan (and define "recent" as) a 6x longer stretch.
  assert.equal(tip - eth, (tip - base) / 6n);
});

test("window floors at the registry's own first block", () => {
  // A window wider than the chain must not underflow into negative blocks.
  assert.equal(feedbackWindowFromBlock(1_000n, 7, BASE_BLOCKS_PER_DAY, FLOOR), FLOOR);
});

function entry(over: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    clientAddress: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
    blockNumber: 100n,
    txHash: "0xdead",
    logIndex: 0,
    ...over,
  };
}

test("summarize matches what the raw log scan produced", () => {
  // Same counting rule as before: one per log, clients deduped case-insensitively.
  const stats = summarizeFeedback(
    [
      entry({ txHash: "0x1", clientAddress: "0xAbC0000000000000000000000000000000000001" }),
      entry({ txHash: "0x2", clientAddress: "0xabc0000000000000000000000000000000000001" }),
      entry({ txHash: "0x3", clientAddress: "0xDEF0000000000000000000000000000000000002" }),
    ],
    0n,
    7,
  );

  assert.equal(stats.recentCount, 3);
  assert.equal(stats.uniqueClients, 2);
  assert.equal(stats.windowDays, 7);
});

test("overlap between the index and the live tail is not double counted", () => {
  // The checkpoint advances between the DB read and the tip read, and a chunk
  // replayed after a partial indexer run lands twice. Counting a log twice
  // would inflate recentCount and manufacture review_velocity_anomaly on an
  // honest agent — a BLOCK invented out of bookkeeping.
  const shared = entry({ txHash: "0xSAME", logIndex: 4 });
  const stats = summarizeFeedback([shared, { ...shared }, entry({ txHash: "0xother" })], 0n, 7);

  assert.equal(stats.recentCount, 2);
});

test("same tx, different log index, are distinct feedback", () => {
  const stats = summarizeFeedback(
    [entry({ txHash: "0xsame", logIndex: 0 }), entry({ txHash: "0xsame", logIndex: 1 })],
    0n,
    7,
  );

  assert.equal(stats.recentCount, 2);
});

test("tx hash casing does not split one log into two", () => {
  const stats = summarizeFeedback(
    [entry({ txHash: "0xABCD", logIndex: 2 }), entry({ txHash: "0xabcd", logIndex: 2 })],
    0n,
    7,
  );

  assert.equal(stats.recentCount, 1);
});

test("the live tail obeys the same window boundary as the indexed rows", () => {
  // The tail is scanned from the checkpoint, which may sit BEFORE the window
  // start. Those older logs are real, but they are not "recent".
  const stats = summarizeFeedback(
    [
      entry({ txHash: "0xold", blockNumber: 99n }),
      entry({ txHash: "0xedge", blockNumber: 100n }),
      entry({ txHash: "0xnew", blockNumber: 101n }),
    ],
    100n,
    7,
  );

  assert.equal(stats.recentCount, 2);
});

test("a log that cannot be placed in the window is not counted", () => {
  // A pending log has no block number. Counting it would credit it to
  // whatever range it happened to satisfy.
  const stats = summarizeFeedback([entry({ blockNumber: null, txHash: "0xpending" })], 0n, 7);

  assert.equal(stats.recentCount, 0);
  assert.equal(stats.uniqueClients, 0);
});

test("no feedback in the window is zero, and zero is a fact", () => {
  const stats = summarizeFeedback([], 0n, 7);

  assert.deepEqual(stats, { recentCount: 0, uniqueClients: 0, windowDays: 7 });
});

test("the index may not answer a window it never scanned", () => {
  const windowStart = 49_697_600n;

  // Coverage begins before the window — every row in range was scanned.
  assert.equal(indexCoversWindow(49_000_000n, windowStart), true);
  assert.equal(indexCoversWindow(windowStart, windowStart), true);

  // Coverage begins INSIDE the window. Rows before it are missing by
  // construction, so the count would be an undercount wearing the face of a
  // complete answer — the caller must degrade instead.
  assert.equal(indexCoversWindow(49_800_000n, windowStart), false);
});

test("the live tail is bounded, and an overrun degrades rather than scans", () => {
  const max = tailMaxBlocks(BASE_BLOCKS_PER_DAY);

  // Hobby crons run daily with ±59 minutes of slack, so ~25h of lag is normal.
  assert.equal(max, 86_400n);
  assert.equal(tailScanFits(45_000n, max), true);
  assert.equal(tailScanFits(max, max), true);

  // Beyond it the "tail" is just the wide scan this change exists to delete.
  assert.equal(tailScanFits(max + 1n, max), false);
  assert.equal(tailScanFits(302_400n, max), false);
});

test("an index at or past the tip needs no tail scan at all", () => {
  assert.equal(tailScanFits(0n, tailMaxBlocks(BASE_BLOCKS_PER_DAY)), true);
});

test("bootstrap reaches past the 7-day scoring window in a single run", () => {
  const bootstrap = bootstrapBlocks(BASE_BLOCKS_PER_DAY);
  const sevenDays = BigInt(7 * BASE_BLOCKS_PER_DAY);

  // If the first run landed short of 7 days, indexCoversWindow would reject
  // the index and every score would degrade exactly as before the fix.
  assert.ok(bootstrap > sevenDays);
});

test("retention outlives the widest window any caller asks for", () => {
  // outcome-detector asks for up to 30 days (checkReputationNegativeFeedback).
  const retention = retentionBlocks(BASE_BLOCKS_PER_DAY);
  assert.ok(retention > BigInt(30 * BASE_BLOCKS_PER_DAY));
});
