import type { DataCoverage } from "@/lib/scoring/types";
import { getOwnerIndexerStatus } from "@/lib/db/owner-index";
import {
  countDistinctPaymentWallets,
  countRecentX402Payments,
  countTotalX402Payments,
  getX402PaymentStats,
} from "@/lib/db/x402-payments";

export async function getDataCoverage(wallet?: string | null): Promise<DataCoverage> {
  let liveTip: bigint | undefined;
  try {
    const { getPublicClient } = await import("@/lib/chain/client");
    liveTip = await getPublicClient().getBlockNumber();
  } catch {
    // leave undefined
  }

  const [status, paymentRows, distinctWallets, recentPayments30d, walletStats] =
    await Promise.all([
      getOwnerIndexerStatus(liveTip !== undefined ? { liveTip } : undefined),
      countTotalX402Payments(),
      countDistinctPaymentWallets(),
      countRecentX402Payments(30),
      wallet ? getX402PaymentStats(wallet) : Promise.resolve(null),
    ]);

  const settlement = {
    paymentRows,
    distinctWallets,
    recentPayments30d,
    walletHasHistory: (walletStats?.paymentCount ?? 0) > 0,
  };

  if (!status || status.lastBlock === null) {
    return {
      ownerIndexer: {
        status: "unavailable",
        blocksBehind: null,
        lastBlock: null,
        indexedAgentRows: 0,
        staleRisk: true,
      },
      settlement,
    };
  }

  const behind = status.blocksBehind;
  // "synced" only when known to be at tip (behind === 0). Any positive lag is partial.
  const atTip = behind !== null && behind <= 0n;

  return {
    ownerIndexer: {
      status: atTip ? "synced" : "partial",
      blocksBehind: behind !== null ? Number(behind) : null,
      lastBlock: status.lastBlock.toString(),
      indexedAgentRows: status.indexedAgentRows,
      staleRisk: !atTip,
    },
    settlement,
  };
}
