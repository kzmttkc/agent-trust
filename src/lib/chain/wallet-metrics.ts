import type { Address } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { LruCache } from "@/lib/util/lru-cache";
import { getPublicClient } from "./client";
import { WALLET_METRICS_CACHE_TTL_MS } from "./config";
import {
  estimateTransactionCount,
  fetchFirstIncomingTransfer,
  fetchWalletTransactions,
} from "./blockscout";

export type WalletMetrics = {
  address: Address;
  ageDays: number;
  txCount: number;
  funder: Address | null;
  firstTxTimestamp: number | null;
};

const metricsCache = new LruCache<string, { metrics: WalletMetrics; expiresAt: number }>(5000);
const FETCH_TIMEOUT_MS = 8_000;
const MAX_NONCE_TX_COUNT = 50;

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("wallet_metrics_timeout")), FETCH_TIMEOUT_MS);
    }),
  ]);
}

export function invalidateWalletMetricsCache(wallet: string): void {
  metricsCache.delete(wallet.toLowerCase());
}

export async function fetchWalletMetrics(address: Address): Promise<WalletMetrics> {
  const cacheKey = address.toLowerCase();
  const cached = metricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metrics;
  }

  if (isSkipChainReadsEnabled()) {
    return emptyMetrics(address);
  }

  try {
    const [txs, txCount, incoming] = await Promise.all([
      withTimeout(fetchWalletTransactions(address, { sort: "asc", offset: 1 })),
      withTimeout(fetchTransactionCount(address)),
      withTimeout(fetchFirstIncomingTransfer(address)),
    ]);

    const firstTx = txs[0];
    const firstTxTimestamp = firstTx ? Number(firstTx.timeStamp) : null;
    const ageDays =
      firstTxTimestamp !== null
        ? Math.max(0, Math.floor((Date.now() - firstTxTimestamp * 1000) / (24 * 60 * 60 * 1000)))
        : 0;

    const metrics: WalletMetrics = {
      address,
      ageDays,
      txCount,
      funder: incoming?.funder ?? null,
      firstTxTimestamp,
    };

    metricsCache.set(cacheKey, {
      metrics,
      expiresAt: Date.now() + WALLET_METRICS_CACHE_TTL_MS,
    });

    return metrics;
  } catch (error) {
    // Never cache soft-failures as empty metrics (that demotes funding_cluster detection).
    throw new Error("wallet_metrics_unavailable", { cause: error });
  }
}

async function fetchTransactionCount(address: Address): Promise<number> {
  const blockscoutCount = await estimateTransactionCount(address);
  if (blockscoutCount > 0) {
    return blockscoutCount;
  }

  try {
    const client = getPublicClient();
    const nonceCount = Number(await client.getTransactionCount({ address }));
    return Math.min(nonceCount, MAX_NONCE_TX_COUNT);
  } catch {
    return 0;
  }
}

function emptyMetrics(address: Address): WalletMetrics {
  return {
    address,
    ageDays: 0,
    txCount: 0,
    funder: null,
    firstTxTimestamp: null,
  };
}
