import { countAgentsByOwner } from "@/lib/chain/agent-resolver";
import type { AgentIdentity, RecentFeedbackStats } from "@/lib/chain/erc8004";
import { getFunderClusterSize, isFundingCluster } from "@/lib/db/funder-index";
import type { WalletMetrics } from "@/lib/chain/wallet-metrics";

export type SybilContext = {
  identity: AgentIdentity;
  walletMetrics: WalletMetrics;
  feedbackStats: RecentFeedbackStats;
  totalFeedbackCount: number;
};

export type ReputationSybilContext = {
  identity: AgentIdentity;
  feedbackStats: RecentFeedbackStats;
  totalFeedbackCount: number;
};

export async function detectSybilFlags(ctx: SybilContext): Promise<string[]> {
  const flags = await detectReputationSybilFlags({
    identity: ctx.identity,
    feedbackStats: ctx.feedbackStats,
    totalFeedbackCount: ctx.totalFeedbackCount,
  });

  if (ctx.walletMetrics.ageDays < 7 && ctx.walletMetrics.txCount < 5) {
    flags.push("new_burner_wallet");
  }

  if (ctx.walletMetrics.funder) {
    const clusterSize = await getFunderClusterSize(ctx.walletMetrics.funder);
    if (isFundingCluster(clusterSize)) {
      flags.push("funding_cluster");
    }
  }

  return [...new Set(flags)];
}

/** Sybil checks that do not require wallet metrics (registered agents without bound wallet). */
export async function detectReputationSybilFlags(
  ctx: ReputationSybilContext,
): Promise<string[]> {
  const flags: string[] = [];

  if (ctx.identity.registered && !ctx.identity.agentWallet) {
    flags.push("no_bound_wallet");
  }

  if (ctx.identity.owner) {
    const ownerAgentCount = await countAgentsByOwner(ctx.identity.owner);
    if (ownerAgentCount >= 3) {
      flags.push("multi_agent_owner");
    }
  }

  const { recentCount, uniqueClients } = ctx.feedbackStats;
  if (recentCount >= 5 && uniqueClients <= 2) {
    flags.push("review_velocity_anomaly");
  } else if (recentCount >= 10 && ctx.totalFeedbackCount >= 10) {
    flags.push("review_velocity_anomaly");
  }

  return [...new Set(flags)];
}

export function assessSybilRisk(
  flags: string[],
): "low" | "medium" | "high" {
  if (flags.includes("wallet_mismatch")) return "high";
  if (flags.includes("wallet_verification_failed")) return "high";
  if (flags.includes("no_bound_wallet") && flags.includes("review_velocity_anomaly")) {
    return "high";
  }
  if (flags.length >= 3) return "high";
  if (flags.includes("funding_cluster") && flags.includes("multi_agent_owner")) {
    return "high";
  }
  if (flags.length >= 1) return "medium";
  return "low";
}
