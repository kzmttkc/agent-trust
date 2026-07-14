export type TrustScoreResult = {
  agentId: string;
  wallet: string | null;
  trustScore: number;
  recommendation: "ALLOW" | "WARN" | "BLOCK";
  signals: {
    identity: { registered: boolean; hasMetadataUri: boolean };
    reputation: { feedbackCount: number; avgScore: number; onChainAvgScore: number };
    wallet: { ageDays: number; txCount: number; isBurner: boolean };
    x402?: { paymentCount: number; uniqueDays: number; score: number };
    sybil: { risk: string; flags: string[] };
    manual: { list: string };
  };
  scoredAt: string;
  cacheExpiresAt: string;
  disclaimer: string;
  blockReason?: string;
  manualOverride?: boolean;
};

export type VouchClientConfig = {
  apiUrl: string;
  apiKey: string;
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const AGENT_ID_RE = /^\d+$/;

function getConfig(): VouchClientConfig {
  const apiUrl = process.env.VOUCH_API_URL ?? "http://localhost:3000/api/v1";
  const apiKey = process.env.VOUCH_API_KEY;

  if (!apiKey) {
    throw new Error("VOUCH_API_KEY is required");
  }

  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

function assertAgentId(agentId: string): void {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error("invalid_agent_id");
  }
}

function assertWallet(wallet: string): void {
  if (!WALLET_RE.test(wallet)) {
    throw new Error("invalid_wallet_address");
  }
}

async function vouchFetch<T>(path: string): Promise<T> {
  const { apiUrl, apiKey } = getConfig();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `vouch_api_error_${response.status}`);
  }

  return data as T;
}

export async function fetchAgentScore(agentId: string, wallet?: string): Promise<TrustScoreResult> {
  assertAgentId(agentId);
  if (wallet) assertWallet(wallet);

  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  return vouchFetch<TrustScoreResult>(`/agents/${agentId}/score${query}`);
}

export async function fetchWalletScore(wallet: string): Promise<TrustScoreResult> {
  assertWallet(wallet);
  return vouchFetch<TrustScoreResult>(`/wallets/${wallet}/score`);
}
