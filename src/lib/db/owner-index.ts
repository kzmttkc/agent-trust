import { count, eq, sql } from "drizzle-orm";
import type { Address } from "viem";
import { getDb } from "./client";
import { indexerCheckpoints, ownerAgents } from "./schema";

export const OWNER_INDEX_CHECKPOINT = "identity_registry";

/**
 * WalletSet 索引の到達点（2026-08-13）。owner 側とは別 scope である必要がある——
 * owner の scope はすでに tip なので、相乗りすると WalletSet の履歴が永久に
 * 埋まらない。
 */
export const AGENT_WALLET_INDEX_CHECKPOINT = "identity_registry_wallets";

/** Blocks behind live tip treated as fully caught up for trusting the DB index alone. */
export const INDEX_CATCHUP_MARGIN_BLOCKS = 0n;

/** Blocks behind live tip that flags "lagging" in deep health (informational, not HTTP 503). */
const DEFAULT_HEALTH_INDEXER_LAG_BLOCKS = 500_000n;

export function getOwnerIndexerLagThreshold(): bigint {
  const raw = process.env.HEALTH_INDEXER_LAG_BLOCKS;
  if (!raw) return DEFAULT_HEALTH_INDEXER_LAG_BLOCKS;
  try {
    const parsed = BigInt(raw);
    return parsed > 0n ? parsed : DEFAULT_HEALTH_INDEXER_LAG_BLOCKS;
  } catch {
    return DEFAULT_HEALTH_INDEXER_LAG_BLOCKS;
  }
}

export type OwnerIndexerStatus = {
  scope: string;
  lastBlock: bigint | null;
  chainTipAtRun: bigint | null;
  /** Prefer live tip when provided by health checks. */
  liveTip: bigint | null;
  blocksBehind: bigint | null;
  caughtUp: boolean;
  indexedAgentRows: number;
};

export async function getIndexerCheckpoint(scope: string): Promise<bigint | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select({ lastBlock: indexerCheckpoints.lastBlock })
    .from(indexerCheckpoints)
    .where(eq(indexerCheckpoints.scope, scope))
    .limit(1);

  return rows[0]?.lastBlock ?? null;
}

export async function setIndexerCheckpoint(
  scope: string,
  lastBlock: bigint,
  chainTipAtRun?: bigint,
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db
    .insert(indexerCheckpoints)
    .values({
      scope,
      lastBlock,
      chainTipAtRun: chainTipAtRun ?? null,
    })
    .onConflictDoUpdate({
      target: indexerCheckpoints.scope,
      set: {
        // Guard against regressions: a stale/out-of-order indexer run must
        // never move the checkpoint backwards.
        lastBlock: sql`GREATEST(${indexerCheckpoints.lastBlock}, excluded.last_block)`,
        chainTipAtRun: chainTipAtRun ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function getOwnerIndexerStatus(options?: {
  liveTip?: bigint;
}): Promise<OwnerIndexerStatus | null> {
  const db = getDb();
  if (!db) return null;

  const [checkpointRows, countRows] = await Promise.all([
    db
      .select({
        lastBlock: indexerCheckpoints.lastBlock,
        chainTipAtRun: indexerCheckpoints.chainTipAtRun,
      })
      .from(indexerCheckpoints)
      .where(eq(indexerCheckpoints.scope, OWNER_INDEX_CHECKPOINT))
      .limit(1),
    db.select({ value: count() }).from(ownerAgents),
  ]);

  const row = checkpointRows[0];
  if (!row) return null;

  const tipForLag = options?.liveTip ?? row.chainTipAtRun;
  const blocksBehind =
    tipForLag !== null && tipForLag !== undefined && row.lastBlock !== null
      ? tipForLag - row.lastBlock
      : null;

  return {
    scope: OWNER_INDEX_CHECKPOINT,
    lastBlock: row.lastBlock,
    chainTipAtRun: row.chainTipAtRun,
    liveTip: options?.liveTip ?? null,
    blocksBehind,
    caughtUp:
      blocksBehind !== null && blocksBehind <= INDEX_CATCHUP_MARGIN_BLOCKS,
    indexedAgentRows: countRows[0]?.value ?? 0,
  };
}

export async function isOwnerIndexCaughtUp(): Promise<boolean> {
  try {
    const { getPublicClient } = await import("@/lib/chain/client");
    const liveTip = await getPublicClient().getBlockNumber();
    const status = await getOwnerIndexerStatus({ liveTip });
    return status?.caughtUp ?? false;
  } catch {
    // Fail closed: never treat index as synced without a live tip.
    return false;
  }
}

/**
 * Returns indexed owner→agent count when a checkpoint exists.
 * Partial sync is intentional — callers must not treat this as definitive alone.
 */
export async function getOwnerAgentCountFromIndex(owner: Address): Promise<number | null> {
  const db = getDb();
  if (!db) return null;

  const checkpoint = await getIndexerCheckpoint(OWNER_INDEX_CHECKPOINT);
  if (checkpoint === null) return null;

  const rows = await db
    .select({ value: count() })
    .from(ownerAgents)
    .where(eq(ownerAgents.owner, owner.toLowerCase()));

  return rows[0]?.value ?? 0;
}
