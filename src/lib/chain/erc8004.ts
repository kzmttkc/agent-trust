import { type Address, isAddress, parseAbi, parseAbiItem, zeroAddress } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { getLogsChunked } from "./chunked-logs";
import { getPublicClient } from "./client";
import { ERC8004_ADDRESSES, IDENTITY_REGISTRY_FROM_BLOCK } from "./config";
import { DEFAULT_CHAIN_ID, chainById } from "./chains";

const identityRegistryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

const reputationRegistryAbi = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

export type AgentIdentity = {
  agentId: bigint;
  owner: Address | null;
  agentWallet: Address | null;
  tokenUri: string | null;
  registered: boolean;
};

export async function fetchAgentIdentity(agentId: bigint, chainId?: number): Promise<AgentIdentity> {
  if (isSkipChainReadsEnabled()) {
    return {
      agentId,
      owner: null,
      agentWallet: null,
      tokenUri: null,
      registered: false,
    };
  }

  const client = getPublicClient(chainId);

  try {
    const owner = await client.readContract({
      address: ERC8004_ADDRESSES.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    });

    const tokenUri = await client.readContract({
      address: ERC8004_ADDRESSES.identityRegistry,
      abi: identityRegistryAbi,
      functionName: "tokenURI",
      args: [agentId],
    });

    let agentWallet: Address | null = null;
    try {
      const agentWalletRaw = await client.readContract({
        address: ERC8004_ADDRESSES.identityRegistry,
        abi: identityRegistryAbi,
        functionName: "getAgentWallet",
        args: [agentId],
      });
      agentWallet =
        isAddress(agentWalletRaw) && agentWalletRaw !== zeroAddress
          ? (agentWalletRaw as Address)
          : null;
    } catch (error) {
      throw new Error("agent_wallet_read_unavailable", { cause: error });
    }

    return {
      agentId,
      owner: owner as Address,
      agentWallet,
      tokenUri: tokenUri as string,
      registered: true,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "agent_wallet_read_unavailable" ||
        error.message === "agent_resolve_unavailable")
    ) {
      throw error;
    }

    const message = String((error as Error)?.message ?? error).toLowerCase();
    const missingToken =
      message.includes("reverted") ||
      message.includes("nonexistent") ||
      message.includes("invalid token") ||
      message.includes("owner query for nonexistent");

    if (!missingToken) {
      throw new Error("agent_identity_unavailable", { cause: error });
    }

    return {
      agentId,
      owner: null,
      agentWallet: null,
      tokenUri: null,
      registered: false,
    };
  }
}

export async function fetchReputationSummary(agentId: bigint, chainId?: number) {
  if (isSkipChainReadsEnabled()) {
    return { count: 0, summaryValue: 0, summaryValueDecimals: 0 };
  }

  const client = getPublicClient(chainId);
  const emptyClients: Address[] = [];
  const zeroBytes32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

  try {
    const [count, summaryValue, summaryValueDecimals] = await client.readContract({
      address: ERC8004_ADDRESSES.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      args: [agentId, emptyClients, zeroBytes32, zeroBytes32],
    });

    return {
      count: Number(count),
      summaryValue: Number(summaryValue),
      summaryValueDecimals: Number(summaryValueDecimals),
    };
  } catch (error) {
    throw new Error("reputation_summary_unavailable", { cause: error });
  }
}

export type RecentFeedbackStats = {
  recentCount: number;
  uniqueClients: number;
  windowDays: number;
};

const newFeedbackEvent = parseAbiItem(
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
);

export async function fetchRecentFeedbackStats(
  agentId: bigint,
  windowDays = 7,
  chainId?: number,
): Promise<RecentFeedbackStats> {
  if (isSkipChainReadsEnabled()) {
    return { recentCount: 0, uniqueClients: 0, windowDays };
  }

  const client = getPublicClient(chainId);

  try {
    const latestBlock = await client.getBlockNumber();
    // Chain-aware window: Base mints ~43,200 blocks/day, Ethereum ~7,200.
    // Using the Base figure everywhere would scan a 6x longer window on
    // mainnet — a silent 6x RPC bill and a wrong "recent" definition.
    const chainMeta = chainById(chainId ?? DEFAULT_CHAIN_ID);
    const blocksPerDay = BigInt(chainMeta?.blocksPerDay ?? 43_200);
    const floorBlock = chainMeta?.registryFromBlock ?? IDENTITY_REGISTRY_FROM_BLOCK;
    const fromBlock =
      latestBlock > blocksPerDay * BigInt(windowDays)
        ? latestBlock - blocksPerDay * BigInt(windowDays)
        : floorBlock;

    const logs = (await getLogsChunked(client, {
      address: ERC8004_ADDRESSES.reputationRegistry,
      event: newFeedbackEvent,
      args: { agentId },
      fromBlock,
      toBlock: "latest",
    })) as Array<{ args: { clientAddress?: Address } }>;

    const clients = new Set<string>();
    for (const log of logs) {
      if (log.args.clientAddress) {
        clients.add(log.args.clientAddress.toLowerCase());
      }
    }

    return {
      recentCount: logs.length,
      uniqueClients: clients.size,
      windowDays,
    };
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("feedback_stats_unavailable");
  }
}
