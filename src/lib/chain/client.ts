import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID } from "./config";

export function getPublicClient() {
  const raw = process.env.BASE_RPC_URL?.trim();
  const rpcUrl = raw && raw.length > 0 ? raw : "https://mainnet.base.org";
  return createPublicClient({
    chain: base,
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
