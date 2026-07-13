import type { DataCoverage } from "@/lib/scoring/types";
import { getOwnerIndexerStatus } from "@/lib/db/owner-index";

export async function getDataCoverage(): Promise<DataCoverage> {
  let liveTip: bigint | undefined;
  try {
    const { getPublicClient } = await import("@/lib/chain/client");
    liveTip = await getPublicClient().getBlockNumber();
  } catch {
    // leave undefined
  }

  const status = await getOwnerIndexerStatus(
    liveTip !== undefined ? { liveTip } : undefined,
  );

  if (!status || status.lastBlock === null) {
    return {
      ownerIndexer: {
        status: "unavailable",
        blocksBehind: null,
        lastBlock: null,
        indexedAgentRows: 0,
        staleRisk: true,
      },
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
  };
}
