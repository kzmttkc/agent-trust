import type { Address } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import {
  fetchTokenBalance,
  fetchTokenTransfers,
  fetchWalletBalance,
  fetchWalletTransactions,
} from "@/lib/chain/blockscout";
import { isValidAddress } from "@/lib/chain/client";
import { BASE_USDC_ADDRESS } from "@/lib/chain/config";
import { fetchWalletMetrics } from "@/lib/chain/wallet-metrics";
import { getOutcomesForWallet, type WalletOutcomeRow } from "@/lib/db/outcome-writer";
import { getPayeeStats, type PayeeStats } from "@/lib/db/x402-payments";
import { LruCache } from "@/lib/util/lru-cache";
import { logServerError } from "@/lib/util/log";
import { normalizeWalletScore, toRecommendation } from "./helpers";
import type { Recommendation } from "./types";

const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5_000;

/**
 * Same dust guard as the outcome-detector's rug_pull_outflow check (commit
 * d20fbf0): a drain ratio alone is noise for a long-dormant wallet sitting
 * on a few wei — 0.005 ETH (~$10-20) is comfortably above gas-residue dust
 * on Base while still being a low bar for a wallet that was actually
 * entrusted with payment funds worth draining.
 */
const DRAIN_MIN_VALUE_WEI = 5_000_000_000_000_000n; // 0.005 ETH
/**
 * USDC equivalent of the native dust floor above: $10, in USDC's 6-decimal
 * smallest unit. Same rationale — a "drain" of less than this is gas-residue
 * noise, not an exit scam worth flagging.
 */
const DRAIN_MIN_VALUE_USDC = 10_000_000n; // 10 USDC
const DRAIN_HIGH_RATIO = 0.8;

export type DataDepth = "thin" | "moderate" | "rich";

export type PayeeSignals = {
  receiving: {
    paymentCount: number;
    uniqueDays: number;
    distinctPayers: number;
    score: number;
  };
  walletHealth: {
    ageDays: number;
    txCount: number;
    isBurner: boolean;
    score: number;
  };
  drainPattern: {
    detected: boolean;
    drainRatio: number | null;
    outgoingCount: number;
    incomingCount: number;
    score: number;
  };
  outcomeHistory: {
    types: string[];
    adjustment: number;
  };
  flags: string[];
};

export type PayeeScoreResult = {
  payee: string;
  score: number;
  recommendation: Recommendation;
  dataDepth: DataDepth;
  signals: PayeeSignals;
  scoredAt: string;
  cacheExpiresAt: string;
  disclaimer: string;
};

const cache = new LruCache<string, { result: PayeeScoreResult; expiresAt: number }>(
  CACHE_MAX_ENTRIES,
);

export function invalidatePayeeScoreCache(payee?: string): void {
  if (!payee) {
    cache.clear();
    return;
  }
  cache.delete(payee.toLowerCase());
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("payee_engine_timeout")), FETCH_TIMEOUT_MS);
    }),
  ]);
}

type DrainSignal = {
  detected: boolean;
  drainRatio: number | null;
  outgoingCount: number;
  incomingCount: number;
  unavailable: boolean;
};

type AssetDrainAssessment = {
  detected: boolean;
  drainRatio: number | null;
  outgoingCount: number;
  incomingCount: number;
};

/**
 * Drain assessment for one asset (native ETH or USDC): drain ratio =
 * outgoing total / (outgoing total + remaining balance), detection gated on
 * the asset's own dust floor. The ratio is only reported when the wallet
 * actually *received* this asset — a pure-USDC payee inevitably spends its
 * small gas ETH down to near zero, and without this gate that gas burn would
 * read as a ~1.0 native "drain" and penalize a perfectly healthy payee.
 */
function assessAssetDrain(
  transfers: { from: string; to: string; value: string }[],
  balance: bigint | null,
  addressLower: string,
  minValue: bigint,
): AssetDrainAssessment {
  const incoming = transfers.filter(
    (tx) => tx.to.toLowerCase() === addressLower && BigInt(tx.value) > 0n,
  );
  const outgoing = transfers.filter(
    (tx) => tx.from.toLowerCase() === addressLower && BigInt(tx.value) > 0n,
  );

  const outgoingTotal = outgoing.reduce((sum, tx) => sum + BigInt(tx.value), 0n);
  const currentBalance = balance ?? 0n;
  const denominator = outgoingTotal + currentBalance;

  const rawRatio =
    denominator > 0n ? Number((outgoingTotal * 10_000n) / denominator) / 10_000 : null;
  const drainRatio = incoming.length > 0 ? rawRatio : null;

  const detected =
    incoming.length > 0 &&
    outgoingTotal >= minValue &&
    drainRatio !== null &&
    drainRatio >= DRAIN_HIGH_RATIO;

  return {
    detected,
    drainRatio,
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
  };
}

/**
 * Exit-scam shape check on the payee's own wallet: received funds, then
 * pulled out (near-)everything. Adapted from
 * src/lib/indexer/outcome-detector.ts's classifyWalletActivity, but scored
 * as an all-time snapshot rather than a post-verdict watch window, so it
 * deliberately drops that function's "2+ withdrawals" trigger (routine
 * treasury sweeps to cold storage would false-positive on a long-lived
 * payee) and keeps only the high-drain-ratio + absolute-value floor trigger.
 *
 * Assessed per asset over native ETH *and* Base USDC (the x402 settlement
 * currency — a payee that is only ever paid in USDC has zero native inflows,
 * so a native-only check would sit permanently neutral on exactly the
 * wallets this API scores). Detection fires if either asset shows the drain
 * shape; the reported ratio is the worst (highest) among assets the wallet
 * has actually received.
 */
async function detectDrainPattern(address: Address): Promise<DrainSignal> {
  const empty: DrainSignal = {
    detected: false,
    drainRatio: null,
    outgoingCount: 0,
    incomingCount: 0,
    unavailable: false,
  };

  if (isSkipChainReadsEnabled()) {
    return { ...empty, unavailable: true };
  }

  try {
    const [txs, balance, usdcTxs, usdcBalance] = await Promise.all([
      withTimeout(fetchWalletTransactions(address, { sort: "desc", offset: 100 })),
      withTimeout(fetchWalletBalance(address)),
      withTimeout(
        fetchTokenTransfers(address, {
          contractAddress: BASE_USDC_ADDRESS,
          sort: "desc",
          offset: 100,
        }),
      ),
      withTimeout(fetchTokenBalance(address, BASE_USDC_ADDRESS)),
    ]);

    const addressLower = address.toLowerCase();
    const native = assessAssetDrain(txs, balance, addressLower, DRAIN_MIN_VALUE_WEI);
    const usdc = assessAssetDrain(usdcTxs, usdcBalance, addressLower, DRAIN_MIN_VALUE_USDC);

    const ratios = [native.drainRatio, usdc.drainRatio].filter(
      (ratio): ratio is number => ratio !== null,
    );

    return {
      detected: native.detected || usdc.detected,
      drainRatio: ratios.length > 0 ? Math.max(...ratios) : null,
      outgoingCount: native.outgoingCount + usdc.outgoingCount,
      incomingCount: native.incomingCount + usdc.incomingCount,
      unavailable: false,
    };
  } catch (error) {
    logServerError("payee_drain_check", error);
    return { ...empty, unavailable: true };
  }
}

function scoreReceiving(stats: PayeeStats): number {
  if (stats.paymentCount <= 0) return 50;

  let score = 50;
  if (stats.paymentCount >= 20) score += 20;
  else if (stats.paymentCount >= 10) score += 14;
  else if (stats.paymentCount >= 5) score += 9;
  else if (stats.paymentCount >= 2) score += 5;
  else score += 2;

  if (stats.uniqueDays >= 14) score += 12;
  else if (stats.uniqueDays >= 7) score += 8;
  else if (stats.uniqueDays >= 3) score += 4;

  if (stats.distinctPayers >= 10) score += 18;
  else if (stats.distinctPayers >= 5) score += 12;
  else if (stats.distinctPayers >= 2) score += 6;

  return clamp(score);
}

function scoreDrain(signal: DrainSignal): number {
  if (signal.unavailable) return 50;
  if (signal.incomingCount === 0) return 60;
  if (signal.detected) return 5;
  if (signal.drainRatio === null) return 60;
  if (signal.drainRatio >= 0.5) return 45;
  return 85;
}

function determineDataDepth(stats: PayeeStats): DataDepth {
  if (stats.paymentCount >= 10 && stats.uniqueDays >= 7 && stats.distinctPayers >= 3) {
    return "rich";
  }
  if (stats.paymentCount >= 3 && stats.distinctPayers >= 2) {
    return "moderate";
  }
  return "thin";
}

/**
 * Weights shift by data depth: a wallet with little/no receiving history
 * (thin) can't be judged much on that axis, so cold-start wallets lean on
 * wallet health and drain-pattern signals instead. A wallet with a deep,
 * multi-payer receiving history (rich) is judged mostly on that track
 * record. Each row sums to 1.
 */
const WEIGHTS_BY_DEPTH: Record<
  DataDepth,
  { receiving: number; walletHealth: number; drain: number }
> = {
  thin: { receiving: 0.15, walletHealth: 0.45, drain: 0.4 },
  moderate: { receiving: 0.35, walletHealth: 0.35, drain: 0.3 },
  rich: { receiving: 0.5, walletHealth: 0.25, drain: 0.25 },
};

const NEGATIVE_OUTCOME_TYPES = new Set([
  "rug_pull_outflow",
  "confirmed_fraud",
  "chargeback_dispute",
]);
const POSITIVE_OUTCOME_TYPES = new Set(["sustained_healthy_activity", "confirmed_legitimate"]);

function applyOutcomeAdjustment(
  score: number,
  outcomes: WalletOutcomeRow[],
): { score: number; types: string[]; adjustment: number } {
  const types = [...new Set(outcomes.map((row) => row.outcomeType))];
  const hasNegative = types.some((t) => NEGATIVE_OUTCOME_TYPES.has(t));
  const hasPositive = types.some((t) => POSITIVE_OUTCOME_TYPES.has(t));

  if (hasNegative) {
    const capped = Math.min(score, 15);
    return { score: capped, types, adjustment: capped - score };
  }
  if (hasPositive) {
    const boosted = clamp(score + 8);
    return { score: boosted, types, adjustment: boosted - score };
  }
  return { score, types, adjustment: 0 };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * GET /v1/payees/{address} — "should my agent trust this wallet enough to
 * pay it?" Complements scoreWallet/scoreAgentById (which answer "should I
 * accept payment from this agent?"). Read-only: no writes, no fund movement.
 */
export async function scorePayeeWallet(address: string): Promise<PayeeScoreResult> {
  if (!isValidAddress(address)) {
    throw new Error("invalid_payee_address");
  }

  const addr = address as Address;
  const addrLower = address.toLowerCase();

  const cached = cache.get(addrLower);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const flags: string[] = [];

  const stats = await getPayeeStats(addrLower);

  let walletMetrics: Awaited<ReturnType<typeof fetchWalletMetrics>> | null = null;
  try {
    walletMetrics = await fetchWalletMetrics(addr);
  } catch (error) {
    logServerError("payee_wallet_metrics", error);
    flags.push("wallet_metrics_unavailable");
  }

  const drainSignal = await detectDrainPattern(addr);
  if (drainSignal.unavailable) {
    flags.push("drain_check_unavailable");
  }

  const outcomes = await getOutcomesForWallet(addrLower);

  const walletScore = normalizeWalletScore({
    ageDays: walletMetrics?.ageDays ?? 0,
    txCount: walletMetrics?.txCount ?? 0,
  });

  const receivingScore = scoreReceiving(stats);
  const drainScore = scoreDrain(drainSignal);
  const dataDepth = determineDataDepth(stats);
  const weights = WEIGHTS_BY_DEPTH[dataDepth];

  const preOutcomeScore = clamp(
    receivingScore * weights.receiving +
      walletScore.score * weights.walletHealth +
      drainScore * weights.drain,
  );

  const { score, types: outcomeTypes, adjustment } = applyOutcomeAdjustment(
    preOutcomeScore,
    outcomes,
  );

  for (const type of outcomeTypes) {
    flags.push(
      NEGATIVE_OUTCOME_TYPES.has(type) ? `negative_outcome:${type}` : `positive_outcome:${type}`,
    );
  }
  if (walletScore.isBurner) flags.push("new_burner_wallet");

  const recommendation = toRecommendation(score, false);

  const now = Date.now();
  const result: PayeeScoreResult = {
    payee: addrLower,
    score,
    recommendation,
    dataDepth,
    signals: {
      receiving: {
        paymentCount: stats.paymentCount,
        uniqueDays: stats.uniqueDays,
        distinctPayers: stats.distinctPayers,
        score: receivingScore,
      },
      walletHealth: {
        ageDays: walletMetrics?.ageDays ?? 0,
        txCount: walletMetrics?.txCount ?? 0,
        isBurner: walletScore.isBurner,
        score: walletScore.score,
      },
      drainPattern: {
        detected: drainSignal.detected,
        drainRatio: drainSignal.drainRatio,
        outgoingCount: drainSignal.outgoingCount,
        incomingCount: drainSignal.incomingCount,
        score: drainScore,
      },
      outcomeHistory: {
        types: outcomeTypes,
        adjustment,
      },
      flags: [...new Set(flags)],
    },
    scoredAt: new Date(now).toISOString(),
    cacheExpiresAt: new Date(now + CACHE_TTL_MS).toISOString(),
    disclaimer:
      "Scores are informational only and do not constitute a guarantee, credit assessment, or investment advice. " +
      "This score reflects a wallet's history as a payment recipient (settlement track record, wallet health, and " +
      "outflow pattern) — it is not an identity or legal-standing check.",
  };

  const hasUnavailableFlag = flags.some((flag) => flag.endsWith("_unavailable"));
  if (!hasUnavailableFlag) {
    cache.set(addrLower, { result, expiresAt: now + CACHE_TTL_MS });
  }

  return result;
}
