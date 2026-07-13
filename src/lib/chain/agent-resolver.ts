import { parseAbiItem, type Address } from "viem";
import { getLogsChunked } from "@/lib/chain/chunked-logs";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { readCanonicalAgentWallet } from "./agent-wallet";
import { getPublicClient, isValidAddress } from "./client";
import { ERC8004_ADDRESSES, IDENTITY_REGISTRY_FROM_BLOCK } from "./config";
import {
  getOwnerAgentCountFromIndex,
} from "@/lib/db/owner-index";
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

type IdentityRegistryLog = {
  args: {
    agentId?: bigint;
    owner?: Address;
    wallet?: Address;
  };
};

function agentIdFromLog(log: IdentityRegistryLog): bigint | undefined {
  return log.args.agentId;
}

const identityOwnerAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const identityBalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function isLikelyMissingTokenError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase();
  return (
    message.includes("reverted") ||
    message.includes("nonexistent") ||
    message.includes("invalid token") ||
    message.includes("owner query for nonexistent")
  );
}

/**
 * Wallet used to bind a candidate agentId during resolve:
 * prefer getAgentWallet; else NFT owner (Registered-as-owner path).
 * Throws on RPC failure so callers do not negative-cache as "no agent".
 */
async function resolveWalletForAgent(agentId: bigint): Promise<Address | null> {
  const canonical = await readCanonicalAgentWallet(agentId);
  if (canonical) return canonical;

  const client = getPublicClient();
  try {
    const owner = await client.readContract({
      address: ERC8004_ADDRESSES.identityRegistry,
      abi: identityOwnerAbi,
      functionName: "ownerOf",
      args: [agentId],
    });

    if (isValidAddress(owner)) {
      return owner as Address;
    }
    return null;
  } catch (error) {
    if (isLikelyMissingTokenError(error)) return null;
    throw new Error("agent_resolve_unavailable", { cause: error });
  }
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

  let walletSetLogs: IdentityRegistryLog[];
  let registeredLogs: IdentityRegistryLog[];
  try {
    [walletSetLogs, registeredLogs] = await Promise.all([
      getLogsChunked(client, {
        address: ERC8004_ADDRESSES.identityRegistry,
        event: walletSetEvent,
        args: { wallet },
        fromBlock: IDENTITY_REGISTRY_FROM_BLOCK,
      }) as Promise<IdentityRegistryLog[]>,
      getLogsChunked(client, {
        address: ERC8004_ADDRESSES.identityRegistry,
        event: registeredEvent,
        args: { owner: wallet },
        fromBlock: IDENTITY_REGISTRY_FROM_BLOCK,
      }) as Promise<IdentityRegistryLog[]>,
    ]);
  } catch {
    // Do not cache a negative miss on RPC failure — that silently demotes agent wallets.
    throw new Error("agent_resolve_unavailable");
  }

  const candidates = new Set<bigint>();
  for (const log of walletSetLogs) {
    const agentId = agentIdFromLog(log);
    if (agentId !== undefined) candidates.add(agentId);
  }
  for (const log of registeredLogs) {
    const agentId = agentIdFromLog(log);
    if (agentId !== undefined) candidates.add(agentId);
  }

  const sorted = [...candidates].sort((a, b) => (a > b ? -1 : 1));
  let resolved: bigint | null = null;

  for (const agentId of sorted) {
    // RPC failures while verifying candidates must propagate (no negative cache).
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

/** Authoritative ERC-721 ownership count — O(1), not pad-able via Transfer spam. */
async function balanceOfOwner(owner: Address): Promise<number> {
  const client = getPublicClient();
  const balance = await client.readContract({
    address: ERC8004_ADDRESSES.identityRegistry,
    abi: identityBalanceAbi,
    functionName: "balanceOf",
    args: [owner],
  });

  if (balance > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(balance);
}

/**
 * Prefer ERC-721 balanceOf (authoritative). Cross-check with indexer when present.
 * Never trust a lagging index when live balanceOf is unavailable.
 */
export async function countAgentsByOwner(owner: Address): Promise<number> {
  if (isSkipChainReadsEnabled()) return 0;

  const indexed = await getOwnerAgentCountFromIndex(owner);

  try {
    const onChain = await balanceOfOwner(owner);
    if (indexed === null) return onChain;
    // Index can lag by a few blocks; never under-count vs live balanceOf.
    return Math.max(indexed, onChain);
  } catch {
    // Never trust a lagging index without live balanceOf — fail closed for enforcement.
    throw new Error("owner_count_unavailable");
  }
}
