import { sql } from "drizzle-orm";
import { chainById, DEFAULT_CHAIN_ID } from "@/lib/chain/chains";
import { tailMaxBlocks } from "@/lib/chain/feedback-window";
import { getProductionEnvErrors } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { getFeedbackIndexerStatus } from "@/lib/db/feedback-index";
import {
  getOwnerIndexerLagThreshold,
  getOwnerIndexerStatus,
} from "@/lib/db/owner-index";
import { runScoringProbe } from "./scoring-probe";

export type DeepHealthStatus = "ok" | "degraded";

export type DeepHealthResult = {
  status: DeepHealthStatus;
  /** True only when env / DB / RPC critical checks fail — drives HTTP 503. */
  criticalFailure: boolean;
  checks: Record<string, string>;
  /** Opaque flag for clients; details stay in server logs. */
  env?: { ok: false };
  indexer?: {
    scope: string;
    lastBlock: string | null;
    chainTipAtRun: string | null;
    liveTip: string | null;
    blocksBehind: string | null;
    lagThreshold: string;
    caughtUp: boolean;
    indexedAgentRows: number;
  };
};

export async function runDeepHealthChecks(): Promise<DeepHealthResult> {
  const checks: Record<string, string> = {};
  let criticalFailure = false;

  const envErrors = getProductionEnvErrors();
  if (envErrors.length > 0) {
    checks.env = "error";
    criticalFailure = true;
    for (const message of envErrors) {
      console.error(`[deep-health] env: ${message}`);
    }
  } else {
    checks.env = "ok";
  }

  try {
    const db = getDb();
    if (!db) {
      checks.database = "unconfigured";
      criticalFailure = true;
    } else {
      await db.execute(sql`SELECT 1`);
      checks.database = "ok";
    }
  } catch {
    checks.database = "error";
    criticalFailure = true;
  }

  let liveTip: bigint | undefined;
  try {
    const { getPublicClient } = await import("@/lib/chain/client");
    const client = getPublicClient();
    liveTip = await client.getBlockNumber();
    checks.rpc = "ok";
  } catch {
    checks.rpc = "error";
    criticalFailure = true;
  }

  // The check that actually matters. `rpc` above only proves the endpoint can
  // answer eth_getBlockNumber — it stayed green throughout the 2026-08-12
  // outage, while eth_getLogs failed and every score on the site timed out.
  // Probing the real scoreAgentById() path is the only way this endpoint can
  // tell the truth about the product's core capability.
  const scoring = await runScoringProbe();
  checks.scoring = scoring.status;
  checks.scoring_latency_ms = String(scoring.latencyMs);
  if (scoring.status === "error") {
    criticalFailure = true;
  } else if (scoring.unavailable.length > 0) {
    checks.scoring_unavailable = scoring.unavailable.join(",");
  }

  const indexerStatus = await getOwnerIndexerStatus(
    liveTip !== undefined ? { liveTip } : undefined,
  );
  const lagThreshold = getOwnerIndexerLagThreshold();
  let indexerPayload: DeepHealthResult["indexer"];

  if (!indexerStatus) {
    checks.owner_indexer = "unconfigured";
    // Missing checkpoint during cold start is informational, not a critical outage.
  } else {
    indexerPayload = {
      scope: indexerStatus.scope,
      lastBlock: indexerStatus.lastBlock?.toString() ?? null,
      chainTipAtRun: indexerStatus.chainTipAtRun?.toString() ?? null,
      liveTip: indexerStatus.liveTip?.toString() ?? null,
      blocksBehind: indexerStatus.blocksBehind?.toString() ?? null,
      lagThreshold: lagThreshold.toString(),
      caughtUp: indexerStatus.caughtUp,
      indexedAgentRows: indexerStatus.indexedAgentRows,
    };

    if (indexerStatus.blocksBehind !== null && indexerStatus.blocksBehind > lagThreshold) {
      checks.owner_indexer = "lagging";
    } else if (!indexerStatus.caughtUp) {
      checks.owner_indexer = "partial";
    } else {
      checks.owner_indexer = "ok";
    }
  }

  // The feedback index is now load-bearing for a verdict: when it stops
  // advancing, the unindexed tail eventually exceeds what the request path is
  // allowed to scan, `fetchRecentFeedbackStats` degrades, and every agent goes
  // back to BLOCK — the exact outage this indexer was built to end. That
  // failure is loud in the verdicts but silent in the infrastructure, so the
  // lag is reported here where a human is already looking.
  try {
    const feedbackStatus = await getFeedbackIndexerStatus(
      liveTip !== undefined ? { liveTip } : undefined,
    );
    if (!feedbackStatus) {
      checks.feedback_indexer = "unconfigured";
    } else {
      const behind = feedbackStatus.blocksBehind;
      checks.feedback_indexer_blocks_behind = behind?.toString() ?? "unknown";
      // Past this the tail is wider than the live scan will attempt, so the
      // signal is unavailable rather than merely stale.
      const maxTail = tailMaxBlocks(chainById(DEFAULT_CHAIN_ID)?.blocksPerDay ?? 43_200);
      checks.feedback_indexer =
        behind !== null && behind > maxTail ? "lagging" : "ok";
    }
  } catch {
    checks.feedback_indexer = "error";
  }

  return {
    // A cautious-but-working score is not "ok" — it means an upstream is down
    // and every verdict it produces is being forced conservative.
    status: criticalFailure || scoring.status !== "ok" ? "degraded" : "ok",
    criticalFailure,
    checks,
    ...(envErrors.length > 0 ? { env: { ok: false as const } } : {}),
    ...(indexerPayload ? { indexer: indexerPayload } : {}),
  };
}
