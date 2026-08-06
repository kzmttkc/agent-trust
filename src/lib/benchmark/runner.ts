import { getDb } from "@/lib/db/client";
import { trustEvents, verdictOutcomes } from "@/lib/db/schema";
import { scoreWallet } from "@/lib/scoring/engine";
import { logServerError } from "@/lib/util/log";
import {
  BENCHMARK_DATASET,
  BENCHMARK_DATASET_VERSION,
  BENCHMARK_SEED_KIND,
  OPERATOR_BENCHMARK_SOURCE,
  type BenchmarkEntry,
} from "./dataset";

// ============================================================
// Vouch — operator benchmark runner (2026-08-06).
//
// One pass = score every dataset address through the SAME engine and the
// SAME fail-closed rules as a live customer lookup (scoreWallet, no special
// context), then record verdict + ground-truth outcome. Nothing is bypassed
// and nothing is special-cased in the engine itself — a benchmark that runs
// on a privileged path would measure the privileged path.
//
// Self-seed separation (the honesty invariant, enforced at write time):
//   - trust_events row:      signals.kind = "benchmark_seed", api_key_id NULL
//   - verdict_outcomes row:  source = "operator_benchmark"
// The external accuracy report excludes this source at the SQL level
// (outcome-reader.ts) and every customer-facing aggregate already filters
// by api_key_id, so seeded rows cannot leak into external numbers.
//
// Outcome semantics reuse the existing vocabulary so the accuracy
// classifier needs no new cases: known-bad → confirmed_fraud (class bad),
// known-good → confirmed_legitimate (class good). windowMinutes = 0 because
// the ground truth predates the verdict — there was no observation window.
// ============================================================

export interface BenchmarkScanResult {
  scanned: number;
  recorded: number;
  errors: number;
  /** entries not attempted because the time budget ran out */
  skipped: number;
  datasetVersion: number;
}

/**
 * Default wall-clock budget. The cron route's maxDuration is 300s; scoring
 * is normally a few seconds per address but each unavailable upstream can
 * burn ~8s (FETCH_TIMEOUT_MS), so we stop starting new entries at 240s and
 * report the remainder as skipped instead of letting the platform kill the
 * run mid-write. The dataset is interleaved bad/good, so a truncated run
 * still samples both classes.
 */
const DEFAULT_TIME_BUDGET_MS = 240_000;

export async function runBenchmarkScan(options?: {
  limit?: number;
  timeBudgetMs?: number;
}): Promise<BenchmarkScanResult> {
  const db = getDb();
  const started = Date.now();
  const budget = options?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const limit = Math.min(options?.limit ?? BENCHMARK_DATASET.length, BENCHMARK_DATASET.length);

  const result: BenchmarkScanResult = {
    scanned: 0,
    recorded: 0,
    errors: 0,
    skipped: 0,
    datasetVersion: BENCHMARK_DATASET_VERSION,
  };

  // No database → nothing can be recorded; scoring anyway would spend RPC
  // quota to throw the answer away. Same degrade-to-no-op discipline as the
  // rest of the outcome pipeline.
  if (!db) {
    result.skipped = limit;
    return result;
  }

  for (let i = 0; i < limit; i++) {
    if (Date.now() - started > budget) {
      result.skipped = limit - i;
      break;
    }
    const entry = BENCHMARK_DATASET[i];
    try {
      result.scanned += 1;
      const recorded = await scoreAndRecord(entry);
      if (recorded) result.recorded += 1;
      else result.errors += 1;
    } catch (error) {
      // Per-entry isolation: one bad RPC read must not abort the pass.
      result.errors += 1;
      logServerError("benchmark_scan_entry", error);
    }
  }

  return result;
}

/** Score one entry and persist verdict + ground-truth outcome. Returns false
 *  (instead of throwing) when the write path degraded, so the caller can
 *  count it without double-logging. */
async function scoreAndRecord(entry: BenchmarkEntry): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  // Empty context on purpose: no apiKeyId means no customer whitelist /
  // blacklist can touch the verdict — only the global engine behaviour that
  // every anonymous caller gets. That is the thing worth benchmarking.
  const score = await scoreWallet(entry.address, {});

  try {
    const inserted = await db
      .insert(trustEvents)
      .values({
        apiKeyId: null, // not customer traffic — also keeps it out of every per-key aggregate
        agentId: score.agentId === "0" ? null : BigInt(score.agentId),
        wallet: score.wallet,
        trustScore: score.trustScore,
        recommendation: score.recommendation,
        signals: {
          kind: BENCHMARK_SEED_KIND,
          benchmark: {
            label: entry.label,
            category: entry.category,
            datasetVersion: BENCHMARK_DATASET_VERSION,
          },
          ...score.signals,
        },
        manualOverride: score.manualOverride ? "true" : "false",
        blockReason: score.blockReason ?? null,
        disclaimer: score.disclaimer,
        cacheExpiresAt: new Date(score.cacheExpiresAt),
      })
      // this drizzle version's returning() takes no column map — full row back
      .returning();

    const trustEventId = inserted[0]?.id;
    if (!trustEventId) return false;

    await db
      .insert(verdictOutcomes)
      .values({
        trustEventId,
        outcomeType: entry.label === "bad" ? "confirmed_fraud" : "confirmed_legitimate",
        relatedWallet: entry.address,
        // Ground truth predates the verdict; there was no observation window.
        windowMinutes: 0,
        source: OPERATOR_BENCHMARK_SOURCE,
        evidence: {
          benchmark: true,
          datasetVersion: BENCHMARK_DATASET_VERSION,
          label: entry.label,
          category: entry.category,
          sourceName: entry.sourceName,
          sourceUrl: entry.sourceUrl,
          note: entry.note,
        },
      })
      // unique(trust_event_id, outcome_type, source) — cannot realistically
      // conflict since the trust event was just created, but keep the write
      // idempotent for retried invocations.
      .onConflictDoNothing();

    return true;
  } catch (error) {
    // Missing table / not-yet-migrated schema degrades to a log line, never
    // a crash — the doctrine every module touching these tables follows.
    logServerError("benchmark_record", error);
    return false;
  }
}
