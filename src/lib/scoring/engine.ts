import { type Address } from "viem";
import { readCanonicalAgentWallet } from "@/lib/chain/agent-wallet";
import { resolveAgentIdByWallet } from "@/lib/chain/agent-resolver";
import { CACHE_TTL_MS } from "@/lib/chain/config";
import { lookupManualListPolicy, type ManualListPolicy } from "@/lib/db/customer-lists";
import {
  fetchAgentIdentity,
  fetchRecentFeedbackStats,
  fetchReputationSummary,
} from "@/lib/chain/erc8004";
import { fetchWalletMetrics, invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { isValidAddress } from "@/lib/chain/client";
import { LruCache } from "@/lib/util/lru-cache";
import { getCacheEpoch } from "./cache-epoch";
import {
  applyManualList,
  applySybilPenalty,
  computeWeightedScore,
  dampenReputationForSybil,
  normalizeWalletScore,
  scoreIdentity,
  scoreReputation,
  toRecommendation,
  walletsMatch,
} from "./helpers";
import { assessSybilRisk, detectReputationSybilFlags, detectSybilFlags } from "./sybil";
import type { AgentIdentity } from "@/lib/chain/erc8004";
import { getDataCoverage } from "@/lib/health/data-coverage";
import type { ScoreRequestContext, TrustScoreResult, TrustSignals } from "./types";

const CACHE_MAX_ENTRIES = 10_000;

/** Chain-derived score payload — policy layer is always applied fresh on read. */
type CachedChainPayload = {
  agentId: bigint;
  wallet: string | null;
  prePolicyScore: number;
  chainSignals: Omit<TrustSignals, "manual">;
  epoch: number;
  expiresAt: number;
};

const memoryCache = new LruCache<string, CachedChainPayload>(CACHE_MAX_ENTRIES);

export function invalidateScoreCache(wallet?: string, agentId?: string): void {
  if (!wallet && !agentId) {
    memoryCache.clear();
    return;
  }

  const walletLower = wallet?.toLowerCase();
  const agentPrefix = agentId ? `agent:${agentId}:` : null;

  for (const key of memoryCache.keys()) {
    const keyLower = key.toLowerCase();
    const walletMatch = walletLower
      ? keyLower.includes(`:${walletLower}:`) ||
        keyLower.endsWith(`:${walletLower}`) ||
        keyLower.startsWith(`wallet:${walletLower}:`)
      : false;
    const agentMatch = agentPrefix ? key.startsWith(agentPrefix) : false;
    if (walletMatch || agentMatch) {
      memoryCache.delete(key);
    }
  }

  if (wallet) {
    invalidateWalletMetricsCache(wallet);
  }
}

function buildAgentCacheKey(
  agentId: bigint,
  canonicalWallet: string | null,
  ctx: ScoreRequestContext,
): string {
  const walletSegment = canonicalWallet?.toLowerCase() ?? "";
  return `agent:${agentId.toString()}:${walletSegment}:${ctx.verifyWallet ?? ""}:${ctx.apiKeyId ?? ""}`;
}

export async function scoreAgentById(
  agentId: bigint,
  ctx: ScoreRequestContext = {},
): Promise<TrustScoreResult> {
  const identity = await fetchAgentIdentity(agentId);
  const verificationBlock = await verifyWalletBinding(agentId, identity, ctx.verifyWallet);
  if (verificationBlock) {
    return verificationBlock;
  }

  const walletAddress = resolveWalletAddress(ctx.verifyWallet, identity.agentWallet);
  const cacheKey = buildAgentCacheKey(agentId, walletAddress, ctx);
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const currentEpoch = await getCacheEpoch(walletAddress);
    if (cached.epoch >= currentEpoch) {
      return applyPolicyLayer(cached, ctx);
    }
    memoryCache.delete(cacheKey);
  }

  let reputation: Awaited<ReturnType<typeof fetchReputationSummary>>;
  let reputationUnavailable = false;
  try {
    reputation = await fetchReputationSummary(agentId);
  } catch {
    reputationUnavailable = true;
    reputation = { count: 0, summaryValue: 0, summaryValueDecimals: 0 };
  }

  let feedbackStats: Awaited<ReturnType<typeof fetchRecentFeedbackStats>>;
  let feedbackStatsUnavailable = false;
  try {
    feedbackStats = await fetchRecentFeedbackStats(agentId);
  } catch {
    feedbackStatsUnavailable = true;
    feedbackStats = { recentCount: 0, uniqueClients: 0, windowDays: 7 };
  }

  let walletMetrics: Awaited<ReturnType<typeof fetchWalletMetrics>> | null = null;
  let walletMetricsUnavailable = false;
  if (walletAddress) {
    try {
      walletMetrics = await fetchWalletMetrics(walletAddress as Address);
    } catch {
      walletMetricsUnavailable = true;
      walletMetrics = {
        address: walletAddress as Address,
        ageDays: 0,
        txCount: 0,
        funder: null,
        firstTxTimestamp: null,
      };
    }
  }

  const walletScore = normalizeWalletScore({
    ageDays: walletMetrics?.ageDays ?? 0,
    txCount: walletMetrics?.txCount ?? 0,
  });

  const identityScore = scoreIdentity(identity.registered, Boolean(identity.tokenUri));
  const onChainAvg =
    reputation.count > 0
      ? reputation.summaryValue / 10 ** reputation.summaryValueDecimals
      : 0;

  let reputationScore = scoreReputation(
    reputation.count,
    reputation.summaryValue,
    reputation.summaryValueDecimals,
  );

  const sybilFlags =
    walletMetrics !== null
      ? await detectSybilFlags({
          identity,
          walletMetrics,
          feedbackStats,
          totalFeedbackCount: reputation.count,
        })
      : await detectReputationSybilFlags({
          identity,
          feedbackStats,
          totalFeedbackCount: reputation.count,
        });

  if (feedbackStatsUnavailable) {
    sybilFlags.push("feedback_stats_unavailable");
  }
  if (reputationUnavailable) {
    sybilFlags.push("reputation_summary_unavailable");
  }
  if (walletMetricsUnavailable) {
    sybilFlags.push("wallet_metrics_unavailable");
  }

  const sybilRisk = assessSybilRisk(sybilFlags);
  reputationScore = dampenReputationForSybil(reputationScore, sybilFlags);

  const prePolicyScore = applySybilPenalty(
    computeWeightedScore(identityScore, reputationScore, walletScore.score),
    sybilFlags,
  );

  const chainSignals: Omit<TrustSignals, "manual"> = {
    identity: {
      registered: identity.registered,
      hasMetadataUri: Boolean(identity.tokenUri),
    },
    reputation: {
      feedbackCount: reputation.count,
      avgScore: reputationScore,
      onChainAvgScore: Math.round(onChainAvg * 100) / 100,
    },
    wallet: {
      ageDays: walletMetrics?.ageDays ?? 0,
      txCount: walletMetrics?.txCount ?? 0,
      isBurner: walletScore.isBurner,
    },
    sybil: {
      risk: sybilRisk,
      flags: sybilFlags,
    },
  };

  const now = Date.now();
  const epoch = await getCacheEpoch(walletAddress);

  const payload: CachedChainPayload = {
    agentId,
    wallet: walletAddress,
    prePolicyScore,
    chainSignals,
    epoch,
    expiresAt: now + CACHE_TTL_MS,
  };

  const availabilityFlags = sybilFlags.some((flag) => flag.endsWith("_unavailable"));
  if (!availabilityFlags) {
    memoryCache.set(cacheKey, payload);
  }
  return applyPolicyLayer(payload, ctx);
}

export async function scoreWallet(
  address: string,
  ctx: ScoreRequestContext = {},
): Promise<TrustScoreResult> {
  if (!isValidAddress(address)) {
    throw new Error("invalid_wallet_address");
  }

  const wallet = address as Address;
  const resolvedAgentId = await resolveAgentIdByWallet(wallet);

  if (resolvedAgentId !== null) {
    return scoreAgentById(resolvedAgentId, { ...ctx, verifyWallet: address });
  }

  const cacheKey = `wallet:${address.toLowerCase()}:${ctx.apiKeyId ?? ""}`;
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const currentEpoch = await getCacheEpoch(address);
    if (cached.epoch >= currentEpoch) {
      return applyPolicyLayer(cached, ctx);
    }
    memoryCache.delete(cacheKey);
  }

  let walletMetrics: Awaited<ReturnType<typeof fetchWalletMetrics>>;
  let walletMetricsUnavailable = false;
  try {
    walletMetrics = await fetchWalletMetrics(wallet);
  } catch {
    walletMetricsUnavailable = true;
    walletMetrics = {
      address: wallet,
      ageDays: 0,
      txCount: 0,
      funder: null,
      firstTxTimestamp: null,
    };
  }

  const walletScore = normalizeWalletScore({
    ageDays: walletMetrics.ageDays,
    txCount: walletMetrics.txCount,
  });

  const sybilFlags = await detectSybilFlags({
    identity: {
      agentId: BigInt(0),
      owner: null,
      agentWallet: wallet,
      tokenUri: null,
      registered: false,
    },
    walletMetrics,
    feedbackStats: { recentCount: 0, uniqueClients: 0, windowDays: 7 },
    totalFeedbackCount: 0,
  });
  if (walletMetricsUnavailable) {
    sybilFlags.push("wallet_metrics_unavailable");
  }

  const sybilRisk = assessSybilRisk(sybilFlags);
  const prePolicyScore = applySybilPenalty(
    computeWeightedScore(30, 30, walletScore.score),
    sybilFlags,
  );

  const chainSignals: Omit<TrustSignals, "manual"> = {
    identity: { registered: false, hasMetadataUri: false },
    reputation: { feedbackCount: 0, avgScore: 0, onChainAvgScore: 0 },
    wallet: {
      ageDays: walletMetrics.ageDays,
      txCount: walletMetrics.txCount,
      isBurner: walletScore.isBurner,
    },
    sybil: {
      risk: sybilRisk,
      flags: sybilFlags,
    },
  };

  const now = Date.now();
  const epoch = await getCacheEpoch(address);

  const payload: CachedChainPayload = {
    agentId: BigInt(0),
    wallet: address,
    prePolicyScore,
    chainSignals,
    epoch,
    expiresAt: now + CACHE_TTL_MS,
  };

  if (!sybilFlags.some((flag) => flag.endsWith("_unavailable"))) {
    memoryCache.set(cacheKey, payload);
  }
  return applyPolicyLayer(payload, ctx);
}

async function applyPolicyLayer(
  payload: CachedChainPayload,
  ctx: ScoreRequestContext,
): Promise<TrustScoreResult> {
  const policy = await lookupManualListPolicy(ctx.apiKeyId, payload.wallet);
  const sybilRisk = payload.chainSignals.sybil.risk;

  const manual = applyManualList(payload.prePolicyScore, policy.effective, sybilRisk);
  const trustScore = manual.score;

  const recommendation = resolveRecommendation(
    trustScore,
    policy.effective,
    sybilRisk,
    manual.recommendation,
  );

  const manualOverride = policy.isGlobal ? false : (manual.manualOverride ?? false);

  const signals: TrustSignals = {
    ...payload.chainSignals,
    manual: { list: policy.visible },
  };

  const now = Date.now();
  const result = buildResult({
    agentId: payload.agentId,
    wallet: payload.wallet,
    trustScore,
    recommendation,
    manualOverride,
    policy,
    signals,
    scoredAt: new Date(now).toISOString(),
    cacheExpiresAt: new Date(payload.expiresAt).toISOString(),
  });
  result.dataCoverage = await getDataCoverage();
  return result;
}

async function verifyWalletBinding(
  agentId: bigint,
  identity: AgentIdentity,
  verifyWallet?: string,
): Promise<TrustScoreResult | null> {
  if (!verifyWallet) return null;

  if (!isValidAddress(verifyWallet)) {
    return buildBlockedResult(agentId, verifyWallet, "invalid_wallet_address", [
      "wallet_verification_failed",
    ]);
  }

  if (!identity.registered) {
    return buildBlockedResult(agentId, verifyWallet, "agent_not_registered", [
      "wallet_verification_failed",
    ]);
  }

  const canonicalWallet =
    identity.agentWallet ?? (await readCanonicalAgentWallet(agentId));

  if (!canonicalWallet) {
    return buildBlockedResult(agentId, verifyWallet, "wallet_verification_unavailable", [
      "wallet_verification_failed",
    ]);
  }

  if (!walletsMatch(canonicalWallet, verifyWallet)) {
    return buildBlockedResult(agentId, verifyWallet, "wallet_mismatch", ["wallet_mismatch"]);
  }

  return null;
}

async function buildBlockedResult(
  agentId: bigint,
  wallet: string,
  reason: string,
  flags: string[],
): Promise<TrustScoreResult> {
  const result: TrustScoreResult = {
    ...buildResult({
      agentId,
      wallet,
      trustScore: 0,
      recommendation: "BLOCK",
      manualOverride: false,
      policy: { effective: "none", visible: "none", isGlobal: false },
      signals: emptySignals({
        sybil: { risk: "high", flags },
      }),
    }),
    blockReason: reason,
  };
  result.dataCoverage = await getDataCoverage();
  return result;
}

function resolveRecommendation(
  trustScore: number,
  effectiveList: "none" | "whitelist" | "blacklist",
  sybilRisk: "low" | "medium" | "high",
  override?: TrustScoreResult["recommendation"],
): TrustScoreResult["recommendation"] {
  if (override) return override;

  // Incomplete or high-risk sybil checks must not clear x402 ALLOW gates.
  if (sybilRisk === "high") {
    return "BLOCK";
  }

  const recommendation = toRecommendation(trustScore, false);
  if (effectiveList === "whitelist" && recommendation === "WARN" && sybilRisk === "low") {
    return "ALLOW";
  }

  return recommendation;
}

function resolveWalletAddress(
  verifyWallet: string | undefined,
  agentWallet: Address | null,
): string | null {
  if (verifyWallet) return verifyWallet;
  if (agentWallet) return agentWallet;
  return null;
}

function buildResult(params: {
  agentId: bigint;
  wallet: string | null;
  trustScore: number;
  recommendation: TrustScoreResult["recommendation"];
  signals: TrustSignals;
  manualOverride: boolean;
  policy: ManualListPolicy;
  scoredAt?: string;
  cacheExpiresAt?: string;
}): TrustScoreResult {
  const now = params.scoredAt ?? new Date().toISOString();
  const expires =
    params.cacheExpiresAt ?? new Date(Date.now() + CACHE_TTL_MS).toISOString();

  let disclaimer =
    "Scores are informational only and do not constitute a guarantee, credit assessment, or investment advice.";

  if (params.policy.isGlobal && params.policy.effective === "blacklist") {
    disclaimer =
      "Access restricted by operator policy. Scores are informational only.";
  } else if (params.signals.manual.list === "whitelist" && params.manualOverride) {
    disclaimer =
      "Score elevated by customer whitelist. Integrators should treat manualOverride=true as a policy decision, not a cryptographic guarantee.";
  } else if (
    params.signals.manual.list === "whitelist" &&
    params.signals.sybil.risk === "high"
  ) {
    disclaimer =
      "Customer whitelist was not applied because sybil risk is high. Scores are informational only.";
  }

  const result: TrustScoreResult = {
    agentId: params.agentId === BigInt(0) ? "0" : params.agentId.toString(),
    wallet: params.wallet,
    trustScore: params.trustScore,
    recommendation: params.recommendation,
    signals: params.signals,
    scoredAt: now,
    cacheExpiresAt: expires,
    disclaimer,
    manualOverride: params.manualOverride,
  };

  if (params.policy.isGlobal && params.policy.effective === "blacklist") {
    result.blockReason = "operator_policy";
  }

  return result;
}

function emptySignals(
  partial: Partial<TrustSignals>,
): TrustSignals {
  return {
    identity: partial.identity ?? { registered: false, hasMetadataUri: false },
    reputation: partial.reputation ?? {
      feedbackCount: 0,
      avgScore: 0,
      onChainAvgScore: 0,
    },
    wallet: partial.wallet ?? { ageDays: 0, txCount: 0, isBurner: false },
    sybil: partial.sybil ?? { risk: "low", flags: [] },
    manual: partial.manual ?? { list: "none" },
  };
}
