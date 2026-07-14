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

export type X402PaymentAttestation = {
  wallet: string;
  txHash: string;
  amount?: string;
  network?: string;
  resource?: string;
};

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

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

/**
 * After x402 verifies payment, attest settlement so Vouch can weight history.
 * Fire-and-forget from middleware — failures must not block the paid route.
 */
export async function reportX402Payment(
  attestation: X402PaymentAttestation,
  config: VouchTrustGateConfig,
): Promise<{ ok: boolean; created?: boolean }> {
  if (!WALLET_RE.test(attestation.wallet)) {
    throw new Error("invalid_wallet_address");
  }
  if (!TX_HASH_RE.test(attestation.txHash)) {
    throw new Error("invalid_tx_hash");
  }

  const apiUrl = config.apiUrl.replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/payments/x402`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(attestation),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `vouch_api_error_${response.status}`);
  }

  return { ok: true, created: Boolean(data.created) };
}

export function shouldReject(
  recommendation: Recommendation,
  rejectOn: Recommendation[] = ["BLOCK"],
): boolean {
  return rejectOn.includes(recommendation);
}
