import { type Address, isAddress, parseAbi, parseAbiItem, zeroAddress } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { getLogsChunked, getLogsChunkSize } from "./chunked-logs";
import { getPublicClient } from "./client";
import { ERC8004_ADDRESSES, IDENTITY_REGISTRY_FROM_BLOCK } from "./config";
import { DEFAULT_CHAIN_ID, chainById } from "./chains";

const identityRegistryAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

/**
 * ReputationRegistry ABI — corrected 2026-08-12 against the DEPLOYED contract.
 *
 * The previous signature took `bytes32 tag1, bytes32 tag2`. The registry at
 * 0x8004BAa1… (ERC-1967 proxy → 0x16e0fa7f…) has no such function: its
 * selector 0x31259cff is absent from the implementation bytecode, so EVERY
 * call reverted, for every agent, since the feature shipped. The engine
 * faithfully converted that into `reputation_summary_unavailable`, which
 * assessSybilRisk maps to high risk → BLOCK. That is why every score on the
 * site read 3/BLOCK: not a rate limit, not a timeout, an ABI that never
 * matched the chain.
 *
 * The deployed function is 0x81bbba58 — tags are `string`, not `bytes32`. It
 * also rejects an empty client list ("clientAddresses required"), so the
 * caller must supply one; getClients() is the registry's own accessor for it.
 *
 * Verified on Base mainnet: agent 1 → 20 clients, count=39, avg 81.
 */
const reputationRegistryAbi = parseAbi([
  "function getClients(uint256 agentId) view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
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

  try {
    const clients = (await client.readContract({
      address: ERC8004_ADDRESSES.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getClients",
      args: [agentId],
    })) as readonly Address[];

    // No clients means no feedback has ever been left — a FACT about this
    // agent, not a failed read. Returning zeros here (rather than letting the
    // empty-list revert become `reputation_summary_unavailable`) is the
    // difference between "this agent has no reputation yet" and "we could not
    // check its reputation". The first is a low score; the second is a BLOCK.
    // Conflating them would BLOCK every brand-new agent on the network.
    if (clients.length === 0) {
      return { count: 0, summaryValue: 0, summaryValueDecimals: 0 };
    }

    const [count, summaryValue, summaryValueDecimals] = await client.readContract({
      address: ERC8004_ADDRESSES.reputationRegistry,
      abi: reputationRegistryAbi,
      functionName: "getSummary",
      // Empty tags = no tag filter, i.e. summarise all feedback from these
      // clients — the same intent the old `bytes32(0)` args carried.
      args: [agentId, clients, "", ""],
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

/**
 * Log-scan settings for the LIVE request path (2026-08-12 outage fix).
 *
 * The 7-day feedback window is ~302,400 Base blocks and eth_getLogs is capped
 * per call, so this scan is dozens of round-trips at best. It had been running
 * with the INDEXER's settings — including GET_LOGS_CHUNK_DELAY_MS, whose mere
 * presence forces getLogsChunked onto its strictly-sequential path. Correct for
 * a nightly batch job that should be polite to the RPC; applied to an
 * interactive score it turned the scan into a ~30s one and blew every caller's
 * time budget.
 *
 * Overrunning the ceiling below is not fatal — the caller converts it into
 * `feedback_stats_unavailable`, which the verdict layer treats as high risk.
 * Slower is allowed to mean "more cautious"; never "hangs".
 *
 * Chunk width: the operator's configured value, never wider.
 *
 * A first cut hardcoded 10,000 here ("the provider maximum"). Production
 * proved that wrong: the configured provider answers a 10,000-block
 * eth_getLogs with a block-range complaint, so EVERY chunk bisected
 * (10,000 → 5,000 → 2,500 …), multiplying one scan into far more calls than
 * the polite sequential version it replaced — and the resulting burst had the
 * provider returning 429 to unrelated reads in the same request, including the
 * identity read the whole score depends on. GET_LOGS_CHUNK_BLOCKS exists
 * precisely because someone already measured what this endpoint accepts;
 * overriding it with a guess made the outage worse, not better.
 *
 * What the live path DOES override is the batch pacing delay (below): that
 * setting exists to be kind to the RPC during nightly catch-up, and its mere
 * presence forces getLogsChunked onto its strictly-sequential path — correct
 * for a cron, wrong for a request someone is waiting on.
 */
function liveScanChunkBlocks(): bigint {
  const configured = getLogsChunkSize();
  return configured < 10_000n ? configured : 10_000n;
}
/**
 * Blast radius, not throughput.
 *
 * A 7-day window is ~302,400 Base blocks; at the operator's configured chunk
 * width that is well over a hundred eth_getLogs calls, which CANNOT complete
 * inside any sane request budget on the current RPC plan. The scan therefore
 * ends in `feedback_stats_unavailable` either way — but while it runs it fires
 * a burst large enough for the provider to start answering 429 to OTHER reads
 * in the same request, including the identity read the entire score depends
 * on. Measured: the health probe failing with
 * `agent_identity_unavailable | cause: Too Many Requests`.
 *
 * So the live attempt is deliberately small and short. Same outcome, a
 * fraction of the quota, and it stops taking the rest of the score down with
 * it. The durable fix is to INDEX NewFeedback events the way owner/funder
 * events already are and read this from the DB — a scan this wide does not
 * belong on a request path at all. Tracked for a decision; deliberately not
 * done here, because silently reshaping a sybil signal is not a hotfix.
 */
const LIVE_SCAN_CONCURRENCY = 2;
const LIVE_SCAN_DEADLINE_MS = 1_500;

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

    const logs = (await getLogsChunked(
      client,
      {
        address: ERC8004_ADDRESSES.reputationRegistry,
        event: newFeedbackEvent,
        args: { agentId },
        fromBlock,
        toBlock: "latest",
      },
      liveScanChunkBlocks(),
      LIVE_SCAN_CONCURRENCY,
      { deadlineMs: LIVE_SCAN_DEADLINE_MS, delayMs: 0 },
    )) as Array<{ args: { clientAddress?: Address } }>;

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
