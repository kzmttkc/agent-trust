import { type Address, parseAbiItem } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { readCanonicalAgentWallet } from "./agent-wallet";
import { getPublicClient, isValidAddress } from "./client";
import { ERC8004_ADDRESSES, IDENTITY_REGISTRY_FROM_BLOCK } from "./config";
import { walletsMatch } from "@/lib/scoring/helpers";
import { LruCache } from "@/lib/util/lru-cache";

const walletSetEvent = parseAbiItem(
  "event WalletSet(uint256 indexed agentId, address indexed wallet)",
);
const registeredEvent = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);

const resolverCache = new LruCache<string, { agentId: bigint | null; expiresAt: number }>(5000);
const RESOLVER_POSITIVE_TTL_MS = 60 * 60 * 1000;
const RESOLVER_NEGATIVE_TTL_MS = 5 * 60 * 1000;

async function resolveWalletForAgent(agentId: bigint): Promise<Address | null> {
  const canonical = await readCanonicalAgentWallet(agentId);
  if (canonical) return canonical;

  const client = getPublicClient();
  try {
    const owner = await client.readContract({
      address: ERC8004_ADDRESSES.identityRegistry,
      abi: [
        {
          type: "function",
          name: "ownerOf",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "address" }],
        },
      ] as const,
      functionName: "ownerOf",
      args: [agentId],
    });

    if (isValidAddress(owner)) {
      return owner as Address;
    }
  } catch {
    // burned or missing token
  }

  return null;
}

export function invalidateResolverCache(wallet?: string): void {
  if (!wallet) {
    for (const key of resolverCache.keys()) {
      resolverCache.delete(key);
    }
    return;
  }
  resolverCache.delete(wallet.toLowerCase());
}

export async function resolveAgentIdByWallet(wallet: Address): Promise<bigint | null> {
  const cacheKey = wallet.toLowerCase();
  const cached = resolverCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.agentId;
  }

  if (isSkipChainReadsEnabled()) {
    return null;
  }

  const client = getPublicClient();
  const fromBlock = IDENTITY_REGISTRY_FROM_BLOCK;

  const [walletSetLogs, registeredLogs] = await Promise.all([
    client.getLogs({
      address: ERC8004_ADDRESSES.identityRegistry,
      event: walletSetEvent,
      args: { wallet },
      fromBlock,
      toBlock: "latest",
    }),
    client.getLogs({
      address: ERC8004_ADDRESSES.identityRegistry,
      event: registeredEvent,
      args: { owner: wallet },
      fromBlock,
      toBlock: "latest",
    }),
  ]);

  const candidates = new Set<bigint>();
  for (const log of walletSetLogs) {
    if (log.args.agentId !== undefined) candidates.add(log.args.agentId);
  }
  for (const log of registeredLogs) {
    if (log.args.agentId !== undefined) candidates.add(log.args.agentId);
  }

  const sorted = [...candidates].sort((a, b) => (a > b ? -1 : 1));
  let resolved: bigint | null = null;

  for (const agentId of sorted) {
    const boundWallet = await resolveWalletForAgent(agentId);
    if (boundWallet && walletsMatch(boundWallet, wallet)) {
      resolved = agentId;
      break;
    }
  }

  resolverCache.set(cacheKey, {
    agentId: resolved,
    expiresAt:
      Date.now() +
      (resolved !== null ? RESOLVER_POSITIVE_TTL_MS : RESOLVER_NEGATIVE_TTL_MS),
  });

  return resolved;
}

export async function countAgentsByOwner(owner: Address): Promise<number> {
  if (isSkipChainReadsEnabled()) return 0;

  const client = getPublicClient();
  const logs = await client.getLogs({
    address: ERC8004_ADDRESSES.identityRegistry,
    event: registeredEvent,
    args: { owner },
    fromBlock: IDENTITY_REGISTRY_FROM_BLOCK,
    toBlock: "latest",
  });

  const uniqueAgents = new Set<bigint>();
  for (const log of logs) {
    if (log.args.agentId !== undefined) uniqueAgents.add(log.args.agentId);
  }

  let ownedCount = 0;
  for (const agentId of uniqueAgents) {
    try {
      const currentOwner = await client.readContract({
        address: ERC8004_ADDRESSES.identityRegistry,
        abi: [
          {
            type: "function",
            name: "ownerOf",
            stateMutability: "view",
            inputs: [{ name: "tokenId", type: "uint256" }],
            outputs: [{ name: "", type: "address" }],
          },
        ] as const,
        functionName: "ownerOf",
        args: [agentId],
      });

      if (
        isValidAddress(currentOwner) &&
        currentOwner.toLowerCase() === owner.toLowerCase()
      ) {
        ownedCount++;
      }
    } catch {
      // burned or missing token
    }
  }

  return ownedCount;
}
