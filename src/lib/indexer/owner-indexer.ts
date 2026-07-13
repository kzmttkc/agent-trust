import { parseAbiItem, zeroAddress, type Address } from "viem";
import { getLogsChunked } from "@/lib/chain/chunked-logs";
import { getPublicClient, isValidAddress } from "@/lib/chain/client";
import { ERC8004_ADDRESSES, IDENTITY_REGISTRY_FROM_BLOCK } from "@/lib/chain/config";
import {
  getIndexerCheckpoint,
  OWNER_INDEX_CHECKPOINT,
  setIndexerCheckpoint,
} from "@/lib/db/owner-index";
import {
  removeAgentFromIndex,
  removeOwnerAgent,
  upsertOwnerAgent,
} from "@/lib/db/owner-index-writer";

const registeredEvent = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

const identityOwnerAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export type OwnerIndexResult = {
  fromBlock: string;
  toBlock: string;
  registeredEvents: number;
  transferEvents: number;
  upserted: number;
  removed: number;
  caughtUp: boolean;
};

const DEFAULT_MAX_BLOCKS = 150_000n;

async function verifyCurrentOwner(owner: Address, agentId: bigint): Promise<boolean> {
  const client = getPublicClient();
  try {
    const currentOwner = await client.readContract({
      address: ERC8004_ADDRESSES.identityRegistry,
      abi: identityOwnerAbi,
      functionName: "ownerOf",
      args: [agentId],
    });
    return (
      isValidAddress(currentOwner) &&
      currentOwner.toLowerCase() === owner.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function syncOwnerAgent(owner: Address, agentId: bigint): Promise<boolean> {
  if (!(await verifyCurrentOwner(owner, agentId))) return false;
  await upsertOwnerAgent(owner, agentId);
  return true;
}

export async function indexOwnerAgents(options?: {
  maxBlocks?: bigint;
}): Promise<OwnerIndexResult> {
  const client = getPublicClient();
  const chainTip = await client.getBlockNumber();
  const fromBlock = (await getIndexerCheckpoint(OWNER_INDEX_CHECKPOINT)) ?? IDENTITY_REGISTRY_FROM_BLOCK;

  const maxBlocks = options?.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const toBlock = fromBlock + maxBlocks > chainTip ? chainTip : fromBlock + maxBlocks;

  const empty: OwnerIndexResult = {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    registeredEvents: 0,
    transferEvents: 0,
    upserted: 0,
    removed: 0,
    caughtUp: fromBlock >= chainTip,
  };

  if (fromBlock > toBlock) {
    await setIndexerCheckpoint(OWNER_INDEX_CHECKPOINT, chainTip, chainTip);
    return { ...empty, caughtUp: true };
  }

  const [registeredLogs, transferLogs] = await Promise.all([
    getLogsChunked(client, {
      address: ERC8004_ADDRESSES.identityRegistry,
      event: registeredEvent,
      fromBlock,
      toBlock,
    }),
    getLogsChunked(client, {
      address: ERC8004_ADDRESSES.identityRegistry,
      event: transferEvent,
      fromBlock,
      toBlock,
    }),
  ]);

  let upserted = 0;
  let removed = 0;

  for (const log of registeredLogs) {
    const agentId = (log as { args: { agentId?: bigint; owner?: Address } }).args.agentId;
    const owner = (log as { args: { agentId?: bigint; owner?: Address } }).args.owner;
    if (agentId === undefined || !owner || !isValidAddress(owner)) continue;
    if (await syncOwnerAgent(owner, agentId)) upserted++;
  }

  const transferOrdered = [...transferLogs].sort((a, b) => {
    const aBlock = a.blockNumber ?? 0n;
    const bBlock = b.blockNumber ?? 0n;
    const blockDelta = Number(aBlock - bBlock);
    if (blockDelta !== 0) return blockDelta;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  for (const log of transferOrdered) {
    const args = (log as {
      args: { tokenId?: bigint; from?: Address; to?: Address };
    }).args;
    const agentId = args.tokenId;
    const from = args.from;
    const to = args.to;
    if (agentId === undefined) continue;

    if (from && isValidAddress(from) && from !== zeroAddress) {
      await removeOwnerAgent(from, agentId);
      removed++;
    }

    if (to && isValidAddress(to) && to !== zeroAddress) {
      await removeAgentFromIndex(agentId);
      if (await syncOwnerAgent(to, agentId)) upserted++;
    } else {
      await removeAgentFromIndex(agentId);
      removed++;
    }
  }

  const nextBlock = toBlock + 1n;
  const caughtUp = nextBlock > chainTip;
  await setIndexerCheckpoint(
    OWNER_INDEX_CHECKPOINT,
    caughtUp ? chainTip : nextBlock,
    chainTip,
  );

  return {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    registeredEvents: registeredLogs.length,
    transferEvents: transferLogs.length,
    upserted,
    removed,
    caughtUp,
  };
}
