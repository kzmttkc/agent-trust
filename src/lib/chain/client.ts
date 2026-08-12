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

/**
 * The endpoint that can actually serve eth_getLogs (2026-08-12).
 *
 * MEASURED, not assumed. On this deployment the live endpoint behind
 * BASE_RPC_URL rejects eth_getLogs outright — it answers
 * "JSON is not a valid request object." to a well-formed 680-block query,
 * before range or rate limits enter into it. The indexer endpoint answered
 * 173 consecutive chunks covering 345,600 blocks in 24.8s without a single
 * failure. Same request shape, same chain, opposite outcome.
 *
 * That is the deeper half of the 2026-08-12 scoring outage: the 7-day feedback
 * scan was not merely too many round-trips for a request budget, it was being
 * asked of an endpoint that does not answer this method at all. Moving the
 * scan to a nightly indexer fixed the volume; it would still have failed on
 * the residual live read if that read kept using the live endpoint.
 *
 * So a log read goes where logs are served, regardless of which path is
 * asking. This does not undo the separation below — that exists to keep BATCH
 * volume off the live endpoint's budget, and the only live caller here is a
 * bounded tail read (typically one chunk, hard-capped at two days of blocks
 * with a 2.5s deadline), not a batch.
 */
export function getLogScanClient(chainId: number = DEFAULT_CHAIN_ID) {
  // getIndexerPublicClient is Base-only by construction. Any other chain has
  // no indexer endpoint configured, so its live client is all there is.
  if (chainId === BASE_CHAIN_ID) return getIndexerPublicClient();
  return getPublicClient(chainId);
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
