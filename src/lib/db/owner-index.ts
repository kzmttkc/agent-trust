import { count, eq } from "drizzle-orm";
import type { Address } from "viem";
import { getDb } from "./client";
import { indexerCheckpoints, ownerAgents } from "./schema";

export const OWNER_INDEX_CHECKPOINT = "identity_registry";

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
        lastBlock,
        chainTipAtRun: chainTipAtRun ?? null,
        updatedAt: new Date(),
      },
    });
}

const INDEX_CATCHUP_MARGIN_BLOCKS = 5_000n;

export async function isOwnerIndexCaughtUp(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const rows = await db
    .select({
      lastBlock: indexerCheckpoints.lastBlock,
      chainTipAtRun: indexerCheckpoints.chainTipAtRun,
    })
    .from(indexerCheckpoints)
    .where(eq(indexerCheckpoints.scope, OWNER_INDEX_CHECKPOINT))
    .limit(1);

  const row = rows[0];
  if (!row?.chainTipAtRun) return false;

  return row.chainTipAtRun - row.lastBlock <= INDEX_CATCHUP_MARGIN_BLOCKS;
}

export async function getOwnerAgentCountFromIndex(owner: Address): Promise<number | null> {
  const db = getDb();
  if (!db) return null;

  if (!(await isOwnerIndexCaughtUp())) return null;

  const rows = await db
    .select({ value: count() })
    .from(ownerAgents)
    .where(eq(ownerAgents.owner, owner.toLowerCase()));

  return rows[0]?.value ?? 0;
}
