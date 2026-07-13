import { sql } from "drizzle-orm";
import { getProductionEnvErrors } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import {
  getOwnerIndexerLagThreshold,
  getOwnerIndexerStatus,
} from "@/lib/db/owner-index";

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

  return {
    status: criticalFailure ? "degraded" : "ok",
    criticalFailure,
    checks,
    ...(envErrors.length > 0 ? { env: { ok: false as const } } : {}),
    ...(indexerPayload ? { indexer: indexerPayload } : {}),
  };
}
