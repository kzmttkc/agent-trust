import type { Address } from "viem";
import { invalidateResolverCache, resolveAgentIdByWallet } from "@/lib/chain/agent-resolver";
import { isValidAddress } from "@/lib/chain/client";
import { invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { bumpCacheEpoch } from "./cache-epoch";
import { invalidateScoreCache } from "./engine";

export async function invalidateScoreCacheForListChange(wallet: string): Promise<void> {
  invalidateScoreCache(wallet);
  invalidateResolverCache(wallet);
  invalidateWalletMetricsCache(wallet);

  if (isValidAddress(wallet)) {
    await bumpCacheEpoch(wallet);
  }

  if (!isValidAddress(wallet)) return;

  try {
    const agentId = await resolveAgentIdByWallet(wallet as Address);
    if (agentId !== null) {
      invalidateScoreCache(undefined, agentId.toString());
    }
  } catch {
    // Best-effort invalidation; wallet-scoped keys are already cleared.
  }
}
