import type { Address } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { LruCache } from "@/lib/util/lru-cache";
import { getPublicClient } from "./client";
import { WALLET_METRICS_CACHE_TTL_MS } from "./config";
import { fetchAddressTransactionCount, fetchWalletHistoryHead } from "./blockscout";

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
/**
 * Budget for the OPTIONAL /counters short-circuit.
 *
 * Deliberately much smaller than FETCH_TIMEOUT_MS, because this read is not
 * load-bearing: its only job is to skip the history walk for an address with
 * no history at all. Measured 2026-08-13 on base.blockscout.com, that endpoint
 * took 70,972ms cold and 974-6,041ms warm for a busy wallet — so on a cold
 * cache the optimisation that exists to SAVE work was consuming the entire
 * metrics budget and taking the walk down with it. Nothing that optional gets
 * to spend more than a couple of seconds of a user's request.
 */
const COUNTER_BUDGET_MS = 3_000;

function counterBudgetMs(): number {
  const raw = process.env.WALLET_METRICS_COUNTER_BUDGET_MS;
  if (raw === undefined || raw === "") return COUNTER_BUDGET_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : COUNTER_BUDGET_MS;
}

/**
 * Fetches currently in flight, keyed exactly like the cache.
 *
 * Every surface that shows a verdict — /agent/[id], the passport endpoint,
 * /api/demo/score, the leaderboard — scores through here, and they all expire
 * together. Without coalescing, the moment the cache lapses each one starts
 * its own upstream fetch for the same wallet: several times the requests, at
 * the one instant the rate limiter is most likely to bite, and several
 * independently-computed answers that can disagree with each other. One
 * in-flight fetch per wallet fixes both — the extra callers await the same
 * promise and therefore observe the same metrics, success or failure.
 */
const inFlight = new Map<string, Promise<WalletMetrics>>();

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("wallet_metrics_timeout")), FETCH_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Drop every cached reading for this wallet, on every chain.
 *
 * 2026-08-12: this deleted `wallet.toLowerCase()` while entries are keyed
 * `${chainId}:${wallet}` — so it deleted a key that never exists and quietly
 * invalidated nothing. Callers (a manual list change, a forced rescore) went
 * on reading the stale metrics for the rest of the TTL. Scan the keyspace by
 * suffix instead of rebuilding the key, so this cannot drift out of step with
 * the key format again.
 */
export function invalidateWalletMetricsCache(wallet: string): void {
  const suffix = `:${wallet.toLowerCase()}`;
  for (const key of [...metricsCache.keys()]) {
    if (key.endsWith(suffix)) metricsCache.delete(key);
  }
}

export async function fetchWalletMetrics(address: Address, chainId?: number): Promise<WalletMetrics> {
  // Chain-scoped cache key: the same wallet has different age/activity per
  // chain, and a cross-chain cache hit would be a wrong answer, not a fast one.
  const cacheKey = `${chainId ?? 8453}:${address.toLowerCase()}`;
  const cached = metricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metrics;
  }

  if (isSkipChainReadsEnabled()) {
    return emptyMetrics(address);
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const run = fetchWalletMetricsUncoalesced(address, cacheKey, chainId);
  inFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function fetchWalletMetricsUncoalesced(
  address: Address,
  cacheKey: string,
  chainId?: number,
): Promise<WalletMetrics> {
  try {
    // Ask the cheap, separately-rate-limited v2 counter first: an address with
    // no history on this chain needs no walk at all, and 25 of the benchmark's
    // 42 addresses are exactly that. Only a definite zero short-circuits — a
    // null (v2 unreachable) falls through to the walk, which still fails closed.
    //
    // 2026-08-13: "falls through to the walk" is what this always claimed and
    // what it did NOT do. fetchAddressTransactionCount swallows its own errors
    // into a null, but the withTimeout wrapped around it here did not — a
    // counter that was merely SLOW rejected inside the try below and became
    // wallet_metrics_unavailable, i.e. a fail-closed BLOCK produced by an
    // optional optimisation. Measured the same day: 70,972ms on a cold counter
    // for 0xd8dA…6045 against an 8,000ms wrapper. A budget this read cannot
    // meet must return null, exactly like a 500 from it does.
    const totalTxCount = await fetchAddressTransactionCount(
      address,
      chainId,
      counterBudgetMs(),
    ).catch(() => null);

    // ONE walk, not two. These used to be concurrent calls over the same
    // endpoint for the same wallet — which spent two thirds of Blockscout's
    // burst budget on every single score. See fetchWalletHistoryHead.
    const head =
      totalTxCount === 0
        ? { firstTx: null, incoming: null, nonSelfTxCount: 0 }
        : await withTimeout(fetchWalletHistoryHead(address, chainId));
    const txCount = await resolveTransactionCount(head.nonSelfTxCount, address, chainId);

    const firstTxTimestamp = head.firstTx ? Number(head.firstTx.timeStamp) : null;
    const ageDays =
      firstTxTimestamp !== null
        ? Math.max(0, Math.floor((Date.now() - firstTxTimestamp * 1000) / (24 * 60 * 60 * 1000)))
        : 0;

    const metrics: WalletMetrics = {
      address,
      ageDays,
      txCount,
      funder: head.incoming?.funder ?? null,
      firstTxTimestamp,
    };

    metricsCache.set(cacheKey, {
      metrics,
      expiresAt: Date.now() + WALLET_METRICS_CACHE_TTL_MS,
    });

    return metrics;
  } catch (error) {
    // Never cache soft-failures as empty metrics (that demotes funding_cluster
    // detection), and never substitute a stale or empty reading for a failed
    // one: a read we could not complete is not a wallet we know nothing bad
    // about. The caller flags wallet_metrics_unavailable and fails closed —
    // the retry/coalescing above exists to make this rarer, never to soften it.
    //
    // NAME THE CAUSE HERE (2026-08-13). logServerError prints `error.message`
    // and nothing else, so every one of these reached production as the bare
    // string "wallet_metrics_unavailable" — which upstream, which status code,
    // which endpoint, all discarded at the throw. Diagnosing the 2026-08-13
    // payee outage meant re-deriving from outside the process what the process
    // itself already knew. The tag says WHICH read died; this says WHY.
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[vouch] wallet_metrics_unavailable ${address}: ${detail.slice(0, 300)}`);
    throw new Error("wallet_metrics_unavailable", { cause: error });
  }
}

/**
 * Blockscout's history walk is the primary count. Only when it reports a
 * completely empty history do we ask the RPC for the nonce — an indexer that
 * has not caught up looks identical to a wallet that has never transacted, and
 * the nonce distinguishes them. Unchanged behaviour, just fed from the merged
 * walk instead of a second round trip.
 */
async function resolveTransactionCount(
  historyCount: number,
  address: Address,
  chainId?: number,
): Promise<number> {
  if (historyCount > 0) {
    return historyCount;
  }

  try {
    const client = getPublicClient(chainId);
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
