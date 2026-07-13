import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import { getDb } from "./client";
import { ownerAgents } from "./schema";

/** Trusted indexer write path — never called from live API scoring. */
export async function upsertOwnerAgent(owner: Address, agentId: bigint): Promise<void> {
  const db = getDb();
  if (!db) return;

  const ownerKey = owner.toLowerCase();
  await db
    .insert(ownerAgents)
    .values({ owner: ownerKey, agentId })
    .onConflictDoUpdate({
      target: [ownerAgents.owner, ownerAgents.agentId],
      set: { updatedAt: new Date() },
    });
}

export async function removeOwnerAgent(owner: Address, agentId: bigint): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db
    .delete(ownerAgents)
    .where(
      and(
        eq(ownerAgents.owner, owner.toLowerCase()),
        eq(ownerAgents.agentId, agentId),
      ),
    );
}

export async function removeAgentFromIndex(agentId: bigint): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.delete(ownerAgents).where(eq(ownerAgents.agentId, agentId));
}
