import { erc20Abi, type Address } from "viem";
import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { fetchTokenTransferWindow, fetchWalletTransferWindow } from "@/lib/chain/blockscout";
import { getPublicClient, isValidAddress } from "@/lib/chain/client";
import { BASE_USDC_ADDRESS, SCORE_THRESHOLDS } from "@/lib/chain/config";
import { fetchWalletMetrics } from "@/lib/chain/wallet-metrics";
import { getOutcomesForWallet, type WalletOutcomeRow } from "@/lib/db/outcome-writer";
import { getPayeeStats, type PayeeStats } from "@/lib/db/x402-payments";
import { LruCache } from "@/lib/util/lru-cache";
import { logServerError } from "@/lib/util/log";
import { normalizeWalletScore } from "./helpers";
import { hasUnavailableInput, toRecommendation } from "./verdict";
import type { Recommendation } from "./types";

const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 5_000;

/**
 * Per-leg time budgets, all three env-tunable so production can be re-sized
 * from production's own numbers without a deploy.
 *
 * Sized from measurements taken 2026-08-13 against base.blockscout.com for
 * 0xd8dA…6045 (37,157 transactions on Base), the hardest wallet this engine
 * claims to handle:
 *
 *   v2 /transactions      (2 pages)   18,036ms
 *   v2 /token-transfers   (2 pages)   51,979ms
 *   v1 txlist  offset=100 (1 request)  1,518-4,654ms
 *   v1 tokentx offset=100 (1 request) 10,297ms
 *
 * THOSE FIGURES ARE FROM A LAPTOP, AND THAT MATTERS. The first version of this
 * cut v2 off at 3,500ms on the strength of them — "a quiet wallet answers in
 * well under a second, so nothing legitimate is near this line". Deployed, it
 * took /payee/0x0330070F… from 41/WARN in ~7s to "Not verifiable" in 3.9s:
 * from Vercel's egress the very same read costs 4-7s. The budget was measured
 * in the wrong building. Numbers below are sized from PRODUCTION latency, and
 * the fallback is hedged (blockscout.ts) so that no single one of them can
 * decide a verdict on its own any more.
 *
 * V2_BUDGET is generous because v2 is the preferred source and is never cut
 * short in favour of the fallback — the hedge runs them side by side instead.
 * V1_BUDGET has to clear 10,297ms or the fallback is started and then killed
 * before it can answer, which is worse than having no fallback: the scarce v1
 * request is spent AND the verdict is refused anyway.
 * LEG_BUDGET is the outer ceiling over the hedge (6,000ms) plus the slower
 * arm plus one turn of the v1 pacing gate (2,500ms).
 */
const V2_BUDGET_MS = 14_000;
const V1_BUDGET_MS = 11_000;
const HEDGE_AFTER_MS = 6_000;
const LEG_BUDGET_MS = 20_000;

function envBudget(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

/**
 * Ceiling for a verdict computed with at least one input we could not read.
 *
 * WHY A CEILING AND NOT A PENALTY (2026-08-13). Measured on
 * /payee/0xd8dA…6045: one wallet, one afternoon, nothing changing on chain —
 * 70/ALLOW on first load, 37/BLOCK on reload, 49/WARN on the leaderboard. The
 * whole spread was decided by WHICH upstream read happened to fail, because
 * every missing signal was silently replaced by a plausible middle value
 * (scoreDrain returns a neutral 50 for a check that never ran) and the result
 * was then banded like a measurement. The drain-check-only failure landed on
 * exactly 70 = SCORE_THRESHOLDS.allow, so a wallet whose exit-scam check was
 * never performed cleared the product's most permissive verdict — the
 * fail-OPEN direction, on the buyer-side engine the SDK's SpendGuard consults
 * before releasing funds.
 *
 * A fixed subtraction would not have closed it (84 − 20 is still a passable
 * number). A ceiling states the only thing that is actually true when a read
 * is missing: we cannot certify this wallet above the block line. It sits one
 * point under SCORE_THRESHOLDS.warn rather than at 0, because 0 is what
 * applyManualList uses for an operator blacklist and a degraded read is not an
 * accusation.
 */
const DEGRADED_SCORE_CEILING = SCORE_THRESHOLDS.warn - 1;

/**
 * Ceiling for a verdict where SOME inputs were measured and some were not.
 *
 * The middle case the engine used to collapse into "unavailable" (2026-08-13,
 * operator ruling). A wallet whose USDC outflow we read completely but whose
 * ETH outflow we could not still has a real measurement behind it, and
 * throwing that away is discarding evidence, not being careful. But a partial
 * reading must never clear the ALLOW gate, so it is capped one point under
 * SCORE_THRESHOLDS.allow: the best a partially-read wallet can be told is
 * WARN, while a surviving leg that looks BAD still produces its own BLOCK on
 * the merits. The legs that were not read are named in `signalsUnavailable`.
 */
const PARTIAL_SCORE_CEILING = SCORE_THRESHOLDS.allow - 1;

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
    /** Asset legs that could not be read, e.g. ["native_drain"]. Empty when
     *  both assets were assessed. */
    unmeasured: string[];
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
  /**
   * True when at least one input could not be read, so this is a fail-closed
   * refusal rather than a measurement. `dataDepth` answers "how much history
   * does this wallet have?"; this answers "did we manage to look?" — a
   * data-poor wallet we read completely is not the same as a wallet we could
   * not read at all, and the two used to be indistinguishable to callers.
   */
  degraded: boolean;
  /**
   * Every input that could not be read on this request, named — e.g.
   * ["native_drain"], ["wallet_metrics"], ["outcome_history"]. Empty means the
   * whole assessment was measured.
   *
   * The disclosure half of the partial-measurement rule (2026-08-13): when
   * this is non-empty but `degraded` is false, the score IS backed by real
   * measurements, just not all of them, and it has been capped below ALLOW
   * for exactly that reason. Callers that must not act on an incomplete view
   * can refuse on this field alone, without inferring it from the score.
   */
  signalsUnavailable: string[];
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

async function withTimeout<T>(promise: Promise<T>, budgetMs = FETCH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("payee_engine_timeout")), budgetMs);
    }),
  ]);
}

/** Machine-readable names for the asset legs, reported in signalsUnavailable. */
const NATIVE_LEG = "native_drain";
const USDC_LEG = "usdc_drain";

type DrainSignal = {
  detected: boolean;
  drainRatio: number | null;
  outgoingCount: number;
  incomingCount: number;
  /**
   * Asset legs we could not read, e.g. ["native_drain"]. A leg that failed is
   * named rather than averaged away: the wallet was assessed on the legs that
   * DID answer, and the caller is told which view is missing.
   */
  unmeasured: string[];
  /** True only when NO leg could be read — nothing was measured at all. */
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
 * Current balances, read from the chain rather than from the indexer.
 *
 * These deliberately do NOT swallow their errors into a null: a balance we
 * could not read is the denominator of the drain ratio, and treating it as
 * zero would turn "we don't know what's left" into "nothing is left", i.e.
 * invent a drain. The caller catches and flags drain_check_unavailable.
 */
async function fetchNativeBalance(address: Address): Promise<bigint> {
  return getPublicClient().getBalance({ address });
}

async function fetchErc20Balance(address: Address, token: Address): Promise<bigint> {
  return getPublicClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
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
 *
 * THE LEGS ARE READ INDEPENDENTLY (2026-08-13, operator ruling). They used to
 * share one try/catch and one Promise.all, so a failure on either asset threw
 * the other asset's completed measurement away. Measured that day:
 * base.blockscout.com's v2 `/addresses/{a}/transactions` returned HTTP 500 on
 * 10 of 10 requests while `/token-transfers` on the same host answered — the
 * native leg was dead and the USDC leg, the one that actually matters for an
 * x402 payee, was fully readable. Discarding it produced a "we know nothing"
 * verdict out of data we did in fact have.
 *
 * Discarding a real measurement is not failing closed, it is failing blind.
 * The fail-closed half lives one level up, in scorePayeeWallet: a partially
 * measured wallet is capped below ALLOW no matter how good the surviving leg
 * looks, and the missing leg is named in `unmeasured` so it can be disclosed
 * rather than quietly averaged away.
 */
function windowOptions() {
  return {
    limit: 100,
    v2BudgetMs: envBudget("PAYEE_V2_BUDGET_MS", V2_BUDGET_MS),
    v1BudgetMs: envBudget("PAYEE_V1_BUDGET_MS", V1_BUDGET_MS),
    hedgeAfterMs: envBudget("PAYEE_HEDGE_AFTER_MS", HEDGE_AFTER_MS),
  };
}

async function assessNativeLeg(
  address: Address,
  addressLower: string,
): Promise<AssetDrainAssessment> {
  const legBudget = envBudget("PAYEE_LEG_BUDGET_MS", LEG_BUDGET_MS);
  const [window, balance] = await Promise.all([
    withTimeout(fetchWalletTransferWindow(address, windowOptions()), legBudget),
    withTimeout(fetchNativeBalance(address)),
  ]);
  return assessAssetDrain(window.transfers, balance, addressLower, DRAIN_MIN_VALUE_WEI);
}

async function assessUsdcLeg(
  address: Address,
  addressLower: string,
): Promise<AssetDrainAssessment> {
  const legBudget = envBudget("PAYEE_LEG_BUDGET_MS", LEG_BUDGET_MS);
  const [window, balance] = await Promise.all([
    withTimeout(fetchTokenTransferWindow(address, BASE_USDC_ADDRESS, windowOptions()), legBudget),
    withTimeout(fetchErc20Balance(address, BASE_USDC_ADDRESS)),
  ]);
  return assessAssetDrain(window.transfers, balance, addressLower, DRAIN_MIN_VALUE_USDC);
}

async function detectDrainPattern(address: Address): Promise<DrainSignal> {
  const nothing: DrainSignal = {
    detected: false,
    drainRatio: null,
    outgoingCount: 0,
    incomingCount: 0,
    unmeasured: [NATIVE_LEG, USDC_LEG],
    unavailable: true,
  };

  if (isSkipChainReadsEnabled()) return nothing;

  const addressLower = address.toLowerCase();
  // 2026-08-13: these reads were all Blockscout v1 and fired together. The v1
  // limiter answers three back-to-back requests and then refuses for 95+
  // seconds, renewing the lockout on every request made while limited (see the
  // header of lib/chain/blockscout.ts) — so this check could not succeed even
  // on its own, and it starved fetchWalletMetrics' v1 walk of the same budget.
  // History now comes from v2 (separate, permissive limiter) and the balances
  // from the RPC. Zero v1 requests here.
  const settled = await Promise.allSettled([
    assessNativeLeg(address, addressLower),
    assessUsdcLeg(address, addressLower),
  ]);

  const measured: AssetDrainAssessment[] = [];
  const unmeasured: string[] = [];
  for (const [index, name] of [NATIVE_LEG, USDC_LEG].entries()) {
    const leg = settled[index]!;
    if (leg.status === "fulfilled") {
      measured.push(leg.value);
    } else {
      unmeasured.push(name);
      logServerError(`payee_drain_${name}`, leg.reason);
    }
  }

  if (measured.length === 0) return { ...nothing, unmeasured };

  const ratios = measured
    .map((leg) => leg.drainRatio)
    .filter((ratio): ratio is number => ratio !== null);

  return {
    detected: measured.some((leg) => leg.detected),
    drainRatio: ratios.length > 0 ? Math.max(...ratios) : null,
    outgoingCount: measured.reduce((sum, leg) => sum + leg.outgoingCount, 0),
    incomingCount: measured.reduce((sum, leg) => sum + leg.incomingCount, 0),
    unmeasured,
    unavailable: false,
  };
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
 * GET /v1/payees/{address}/score — "should my agent trust this wallet enough to
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

  // CONCURRENT, NOT SEQUENTIAL (2026-08-13). These four reads share no data —
  // each one's failure is handled on its own below — but they used to run one
  // after another, so the request's wall clock was the SUM of four independent
  // budgets. On a busy wallet that is what pushed the page past the point where
  // any single read could still finish: the drain check did not start until
  // wallet-metrics had spent up to 11s, and then had to fit its own fallback
  // into whatever was left. Running them together makes the request cost the
  // SLOWEST read rather than all of them, which is what gives the v1 fallback
  // room to exist at all. Nothing about which failure means what changes here.
  const [statsResult, metricsResult, drainResult, outcomesResult] = await Promise.allSettled([
    getPayeeStats(addrLower),
    fetchWalletMetrics(addr),
    detectDrainPattern(addr),
    getOutcomesForWallet(addrLower),
  ]);

  // The payment-stats read has no fallback and never had one: it is the local
  // database, and a caller asking for a score cannot be answered without it.
  // Rethrown rather than flagged, exactly as when it was awaited directly.
  if (statsResult.status === "rejected") throw statsResult.reason;
  const stats = statsResult.value;

  let walletMetrics: Awaited<ReturnType<typeof fetchWalletMetrics>> | null = null;
  if (metricsResult.status === "fulfilled") {
    walletMetrics = metricsResult.value;
  } else {
    logServerError("payee_wallet_metrics", metricsResult.reason);
    flags.push("wallet_metrics_unavailable");
  }

  // detectDrainPattern reports its own failures in the signal (it never
  // rejects), so a rejection here is a defect, not an outage — treat it as the
  // most cautious thing it could have returned rather than letting it escape.
  const drainSignal: DrainSignal =
    drainResult.status === "fulfilled"
      ? drainResult.value
      : ((logServerError("payee_drain_check", drainResult.reason),
        {
          detected: false,
          drainRatio: null,
          outgoingCount: 0,
          incomingCount: 0,
          unmeasured: [NATIVE_LEG, USDC_LEG],
          unavailable: true,
        }) as DrainSignal);
  if (drainSignal.unavailable) {
    flags.push("drain_check_unavailable");
  }

  // Outcome history is what caps a wallet with recorded fraud at 15. A read we
  // could not complete must therefore land in the degraded class, not read as
  // "this wallet has no history" — see getOutcomesForWallet's own note.
  let outcomes: WalletOutcomeRow[] = [];
  let outcomeHistoryRead = true;
  if (outcomesResult.status === "fulfilled") {
    outcomes = outcomesResult.value;
  } else {
    logServerError("payee_outcome_history", outcomesResult.reason);
    outcomeHistoryRead = false;
    flags.push("outcome_history_unavailable");
  }

  // Every input we did not manage to read, named for the caller. Assembled
  // from what actually happened above rather than parsed back out of `flags`,
  // so the disclosure cannot drift from the reads it describes.
  const signalsUnavailable = [
    ...(walletMetrics ? [] : ["wallet_metrics"]),
    ...drainSignal.unmeasured,
    ...(outcomeHistoryRead ? [] : ["outcome_history"]),
  ];

  const rawWalletScore = normalizeWalletScore({
    ageDays: walletMetrics?.ageDays ?? 0,
    txCount: walletMetrics?.txCount ?? 0,
  });
  // A failed metrics read leaves ageDays 0 / txCount 0 behind, which
  // normalizeWalletScore reads as `isBurner` — a specific, checkable claim
  // about a wallet nobody managed to look at. The weighting may treat missing
  // history conservatively (that is the fail-closed direction), but the
  // reported signal must not assert a fact we did not observe.
  const walletScore = walletMetrics
    ? rawWalletScore
    : { ...rawWalletScore, isBurner: false };

  const receivingScore = scoreReceiving(stats);
  const drainScore = scoreDrain(drainSignal);
  const dataDepth = determineDataDepth(stats);
  const weights = WEIGHTS_BY_DEPTH[dataDepth];

  const preOutcomeScore = clamp(
    receivingScore * weights.receiving +
      walletScore.score * weights.walletHealth +
      drainScore * weights.drain,
  );

  const { score: measuredScore, types: outcomeTypes, adjustment } = applyOutcomeAdjustment(
    preOutcomeScore,
    outcomes,
  );

  for (const type of outcomeTypes) {
    flags.push(
      NEGATIVE_OUTCOME_TYPES.has(type) ? `negative_outcome:${type}` : `positive_outcome:${type}`,
    );
  }
  if (walletScore.isBurner) flags.push("new_burner_wallet");

  // ---- fail-closed gate ------------------------------------------------
  // The invariant verdict.ts documents for the seller-side engine, applied to
  // the buyer side, which never had it: an `*_unavailable` flag means "we
  // could not check", and that must never leave here dressed as "we checked
  // and it was fine". `hasUnavailableInput` is the shared definition on
  // purpose — a local `.endsWith("_unavailable")` re-implementation is exactly
  // how the two sides drifted apart in the first place.
  const degraded = hasUnavailableInput(flags);
  // The middle case: real measurements, but not all of them. Not degraded (we
  // did measure something), and not clean either — capped below ALLOW so a
  // partial view can never clear the gate, while a surviving leg that looks
  // bad still lands its own BLOCK on the merits.
  const partiallyMeasured = !degraded && signalsUnavailable.length > 0;
  const ceiling = degraded
    ? DEGRADED_SCORE_CEILING
    : partiallyMeasured
      ? PARTIAL_SCORE_CEILING
      : 100;
  const score = Math.min(measuredScore, ceiling);
  // Stated, not inferred from the ceiling: if DEGRADED_SCORE_CEILING were ever
  // moved above the block line, the refusal must not quietly turn into a WARN.
  const recommendation: Recommendation = degraded ? "BLOCK" : toRecommendation(score, false);

  const now = Date.now();
  const result: PayeeScoreResult = {
    payee: addrLower,
    score,
    recommendation,
    dataDepth,
    degraded,
    signalsUnavailable,
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
        unmeasured: drainSignal.unmeasured,
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

  // A verdict the engine is not confident enough to cache is one nobody
  // downstream may pin either (tests/verdict-consistency.test.ts). A partial
  // reading counts: it is capped below ALLOW because of an upstream outage,
  // and pinning it for five minutes would keep the cap in place long after
  // the missing leg came back.
  if (!degraded && !partiallyMeasured) {
    cache.set(addrLower, { result, expiresAt: now + CACHE_TTL_MS });
  }

  return result;
}
