export type TrustScoreResult = {
  agentId: string;
  wallet: string | null;
  trustScore: number;
  recommendation: "ALLOW" | "WARN" | "BLOCK";
  signals: {
    identity: { registered: boolean; hasMetadataUri: boolean };
    reputation: { feedbackCount: number; avgScore: number; onChainAvgScore: number };
    wallet: { ageDays: number; txCount: number; isBurner: boolean };
    x402: { paymentCount: number; uniqueDays: number; score: number };
    sybil: { risk: string; flags: string[] };
    manual: { list: string };
  };
  scoredAt: string;
  cacheExpiresAt: string;
  disclaimer: string;
  blockReason?: string;
  manualOverride?: boolean;
  dataCoverage?: {
    ownerIndexer: {
      status: string;
      blocksBehind: number | null;
      lastBlock?: string | null;
      indexedAgentRows?: number;
      staleRisk: boolean;
    };
    settlement: {
      paymentRows: number;
      distinctWallets?: number;
      recentPayments30d?: number;
      walletHasHistory: boolean;
    };
  };
};

export type VouchClientConfig = {
  apiUrl: string;
  apiKey: string;
};

export type X402PaymentAttestation = {
  wallet: string;
  txHash: string;
  amount?: string;
  network?: string;
  resource?: string;
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
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

export class VouchApiError extends Error {
  /** Present for some error codes (e.g. attestation_unverifiable) with a human-readable detail. */
  reason?: string;

  constructor(code: string, reason?: string) {
    super(code);
    this.name = "VouchApiError";
    this.reason = reason;
  }
}

async function vouchFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiUrl, apiKey } = getConfig();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VouchApiError(data.error ?? `vouch_api_error_${response.status}`, data.reason);
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

export async function attestX402Payment(
  attestation: X402PaymentAttestation,
): Promise<{ ok: boolean; created: boolean; id: string }> {
  assertWallet(attestation.wallet);
  if (!TX_HASH_RE.test(attestation.txHash)) {
    throw new Error("invalid_tx_hash");
  }
  return vouchFetch("/payments/x402", {
    method: "POST",
    body: JSON.stringify(attestation),
  });
}
