export type Recommendation = "ALLOW" | "WARN" | "BLOCK";

export type TrustScoreResult = {
  agentId: string;
  wallet: string | null;
  trustScore: number;
  recommendation: Recommendation;
};

export type VouchTrustGateConfig = {
  apiUrl: string;
  apiKey: string;
  rejectOn?: Recommendation[];
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

export async function fetchWalletTrustScore(
  wallet: string,
  config: VouchTrustGateConfig,
): Promise<TrustScoreResult> {
  if (!WALLET_RE.test(wallet)) {
    throw new Error("invalid_wallet_address");
  }

  const apiUrl = config.apiUrl.replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/wallets/${wallet}/score`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `vouch_api_error_${response.status}`);
  }

  return data as TrustScoreResult;
}

export function shouldReject(
  recommendation: Recommendation,
  rejectOn: Recommendation[] = ["BLOCK"],
): boolean {
  return rejectOn.includes(recommendation);
}
