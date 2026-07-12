import { getDb } from "./client";
import { funderWallets } from "./schema";

/** Trusted indexer write path — never called from API scoring. */
export async function recordFunderWallet(funder: string, wallet: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const funderKey = funder.toLowerCase();
  const walletKey = wallet.toLowerCase();

  const inserted = await db
    .insert(funderWallets)
    .values({ funder: funderKey, wallet: walletKey })
    .onConflictDoNothing()
    .returning();

  return inserted.length > 0;
}
