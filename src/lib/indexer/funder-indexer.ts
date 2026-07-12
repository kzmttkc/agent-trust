import { isNotNull } from "drizzle-orm";
import type { Address } from "viem";
import { isValidAddress } from "@/lib/chain/client";
import { fetchFirstIncomingTransfer } from "@/lib/chain/blockscout";
import { getDb } from "@/lib/db/client";
import { recordFunderWallet } from "@/lib/db/funder-index-writer";
import { customerLists, funderWallets, trustEvents } from "@/lib/db/schema";

export type FunderIndexResult = {
  scanned: number;
  indexed: number;
  skipped: number;
  errors: number;
};

const DEFAULT_BATCH = 50;
const DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collect wallets seen in trust_events / customer_lists that are not yet indexed.
 */
export async function collectWalletsToIndex(limit = DEFAULT_BATCH): Promise<string[]> {
  const db = getDb();
  if (!db) return [];

  const [fromEvents, fromLists, indexed] = await Promise.all([
    db
      .selectDistinct({ wallet: trustEvents.wallet })
      .from(trustEvents)
      .where(isNotNull(trustEvents.wallet)),
    db.selectDistinct({ wallet: customerLists.wallet }).from(customerLists),
    db.selectDistinct({ wallet: funderWallets.wallet }).from(funderWallets),
  ]);

  const indexedSet = new Set(indexed.map((row) => row.wallet.toLowerCase()));
  const candidates = new Set<string>();

  for (const row of [...fromEvents, ...fromLists]) {
    if (!row.wallet || !isValidAddress(row.wallet)) continue;
    const lower = row.wallet.toLowerCase();
    if (!indexedSet.has(lower)) {
      candidates.add(lower);
    }
  }

  return [...candidates].slice(0, limit);
}

export async function indexFunderWallets(options?: {
  limit?: number;
  delayMs?: number;
}): Promise<FunderIndexResult> {
  const limit = options?.limit ?? DEFAULT_BATCH;
  const delayMs = options?.delayMs ?? DELAY_MS;

  const wallets = await collectWalletsToIndex(limit);
  const result: FunderIndexResult = {
    scanned: wallets.length,
    indexed: 0,
    skipped: 0,
    errors: 0,
  };

  for (const wallet of wallets) {
    try {
      const incoming = await fetchFirstIncomingTransfer(wallet as Address);
      if (!incoming) {
        result.skipped++;
        await sleep(delayMs);
        continue;
      }

      const inserted = await recordFunderWallet(incoming.funder, wallet);
      if (inserted) {
        result.indexed++;
      } else {
        result.skipped++;
      }
    } catch {
      result.errors++;
    }

    await sleep(delayMs);
  }

  return result;
}
