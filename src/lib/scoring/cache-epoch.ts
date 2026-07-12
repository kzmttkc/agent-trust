import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { cacheEpochs } from "@/lib/db/schema";

const GLOBAL_SCOPE = "__global__";

export async function getCacheEpoch(wallet: string | null): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const scopes = [GLOBAL_SCOPE];
  if (wallet) scopes.push(wallet.toLowerCase());

  const rows = await db
    .select({ epoch: cacheEpochs.epoch })
    .from(cacheEpochs)
    .where(inArray(cacheEpochs.scope, scopes));

  if (rows.length === 0) return 0;
  return Math.max(...rows.map((row) => row.epoch));
}

export async function bumpCacheEpoch(wallet: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  for (const scope of [GLOBAL_SCOPE, wallet.toLowerCase()]) {
    await db
      .insert(cacheEpochs)
      .values({ scope, epoch: 1 })
      .onConflictDoUpdate({
        target: cacheEpochs.scope,
        set: { epoch: sql`${cacheEpochs.epoch} + 1` },
      });
  }
}
