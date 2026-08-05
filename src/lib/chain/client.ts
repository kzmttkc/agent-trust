import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID } from "./config";
import { DEFAULT_CHAIN_ID, chainById, rpcUrlFor } from "./chains";

/**
 * Chain-aware since 2026-08-05 (C-8). No argument = Base, so every existing
 * caller keeps its exact behaviour. A non-Base chain id resolves through the
 * registry and THROWS when that chain is not enabled in this environment —
 * a read against the wrong chain must be impossible, not merely unlikely.
 */
export function getPublicClient(chainId: number = DEFAULT_CHAIN_ID) {
  const chain = chainById(chainId);
  if (!chain) {
    throw new Error(`unsupported_chain:${chainId}`);
  }
  const rpcUrl = rpcUrlFor(chain);
  if (!rpcUrl) {
    throw new Error(`chain_not_enabled:${chain.slug}`);
  }
  return createPublicClient({
    // Typed as the Base chain so the client's TYPE stays what every existing
    // caller (indexers included) was written against; the RUNTIME chain and
    // transport differ per registry entry. Safe because all callers use only
    // the chain-agnostic read surface (readContract / getBlockNumber /
    // getTransactionReceipt / getLogs).
    chain: chain.viemChain as typeof base,
    transport: http(rpcUrl),
  });
}

/** Separate RPC endpoint for the batch indexers so they don't compete with live API traffic for the same app's CU/s budget. */
export function getIndexerPublicClient() {
  const indexer = process.env.INDEXER_RPC_URL?.trim();
  const baseRpc = process.env.BASE_RPC_URL?.trim();
  const rpcUrl =
    (indexer && indexer.length > 0 ? indexer : null) ??
    (baseRpc && baseRpc.length > 0 ? baseRpc : null) ??
    "https://mainnet.base.org";
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

export function isValidAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function parseAgentId(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;

  try {
    const id = BigInt(value);
    if (id < BigInt(0)) return null;
    return id;
  } catch {
    return null;
  }
}

export const CHAIN_ID = BASE_CHAIN_ID;
