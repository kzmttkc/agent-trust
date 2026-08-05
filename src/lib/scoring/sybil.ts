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
    try {
      const ownerAgentCount = await countAgentsByOwner(ctx.identity.owner);
      if (ownerAgentCount >= 3) {
        flags.push("multi_agent_owner");
      }
    } catch {
      // Cannot verify ownership (RPC outage + index not caught up) — fail closed.
      flags.push("owner_count_unavailable");
    }
  }

  const { recentCount, uniqueClients } = ctx.feedbackStats;
  // Velocity anomaly: high recent volume with low unique clients only.
  // Do not flag healthy high-volume agents with many distinct reviewers.
  if (recentCount >= 5 && uniqueClients <= 2) {
    flags.push("review_velocity_anomaly");
  } else if (recentCount >= 10 && uniqueClients <= 3) {
    flags.push("review_velocity_anomaly");
  }

  return [...new Set(flags)];
}

// assessSybilRisk moved to ./verdict (pure, importable without a database).
// Re-exported so existing call sites keep working.
export { assessSybilRisk } from "./verdict";
export type { SybilRisk } from "./verdict";
