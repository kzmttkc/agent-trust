import type { TrustScoreResult } from "./vouch-client.js";

export function explainTrustScore(result: TrustScoreResult): string {
  const lines = [
    `Agent ID: ${result.agentId}`,
    `Wallet: ${result.wallet ?? "n/a"}`,
    `Trust score: ${result.trustScore}/100`,
    `Recommendation: ${result.recommendation}`,
    "",
    "Identity:",
    `  - Registered: ${result.signals.identity.registered ? "yes" : "no"}`,
    `  - Metadata URI present: ${result.signals.identity.hasMetadataUri ? "yes" : "no"}`,
    "",
    "Reputation:",
    `  - Feedback count: ${result.signals.reputation.feedbackCount}`,
    `  - Normalized score: ${result.signals.reputation.avgScore}`,
    `  - On-chain average: ${result.signals.reputation.onChainAvgScore}`,
    "",
    "Wallet:",
    `  - Age (days): ${result.signals.wallet.ageDays}`,
    `  - Transaction count: ${result.signals.wallet.txCount}`,
    `  - Burner wallet: ${result.signals.wallet.isBurner ? "yes" : "no"}`,
    "",
    "Sybil:",
    `  - Risk: ${result.signals.sybil.risk}`,
    `  - Flags: ${result.signals.sybil.flags.length ? result.signals.sybil.flags.join(", ") : "none"}`,
    "",
    "Manual list:",
    `  - ${result.signals.manual.list}`,
    "",
    `Scored at: ${result.scoredAt}`,
    `Cache expires: ${result.cacheExpiresAt}`,
    "",
    result.disclaimer,
  ];

  return lines.join("\n");
}
