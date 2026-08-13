import { SpendGuard, type SpendGuardPolicy } from "./spend-guard.js";

export {
  SpendGuard,
  type SpendGuardPolicy,
  type SpendGuardTrustPolicy,
  type SpendEvaluateInput,
  type SpendDenyReason,
  type SpendDecision,
} from "./spend-guard.js";

export type Recommendation = "ALLOW" | "WARN" | "BLOCK";

export type TrustScoreResult = {
  agentId: string;
  wallet: string | null;
  trustScore: number;
  recommendation: Recommendation;
  signals: {
    identity: { registered: boolean; hasMetadataUri: boolean };
    reputation: { feedbackCount: number; avgScore: number; onChainAvgScore: number };
    wallet: { ageDays: number; txCount: number; isBurner: boolean };
    x402: { paymentCount: number; uniqueDays: number; score: number };
    sybil: { risk: string; flags: string[] };
    manual: { list: string };
  };
  /** N-21: component-level explanation of the chain score. Optional and absent
   *  on hard-blocked verdicts; the four components sum to weightedSubtotal. */
  breakdown?: {
    components: {
      identity: { score: number; weight: number; contribution: number };
      reputation: { score: number; weight: number; contribution: number };
      wallet: { score: number; weight: number; contribution: number };
      x402: { score: number; weight: number; contribution: number };
    };
    weightedSubtotal: number;
    sybilPenalty: number;
    prePolicyScore: number;
  };
  /** Stable machine-readable reason codes behind the verdict. */
  reasons?: string[];
  scoredAt: string;
  cacheExpiresAt: string;
  disclaimer: string;
  blockReason?: string;
  manualOverride?: boolean;
  dataCoverage?: {
    ownerIndexer: {
      status: "synced" | "partial" | "unavailable";
      blocksBehind: number | null;
      lastBlock: string | null;
      indexedAgentRows: number;
      staleRisk: boolean;
    };
    settlement: {
      paymentRows: number;
      distinctWallets: number;
      recentPayments30d: number;
      walletHasHistory: boolean;
    };
  };
};

export type PayeeDataDepth = "thin" | "moderate" | "rich";

export type PayeeScoreResult = {
  payee: string;
  score: number;
  recommendation: Recommendation;
  dataDepth: PayeeDataDepth;
  /**
   * True when the verdict came from a degraded read — one or more inputs
   * could not be read at all, so the score is a fail-closed refusal, not a
   * measurement. SpendGuard's default policy denies on this.
   */
  degraded: boolean;
  /**
   * Machine-readable names of the inputs that could not be measured. When
   * this is non-empty but `degraded` is false, the score is backed by real
   * but partial measurements — SpendGuard's default policy denies on this
   * too (`payee_partial_measurement`).
   */
  signalsUnavailable: string[];
  signals: {
    receiving: {
      paymentCount: number;
      uniqueDays: number;
      distinctPayers: number;
      score: number;
    };
    walletHealth: { ageDays: number; txCount: number; isBurner: boolean; score: number };
    drainPattern: {
      detected: boolean;
      drainRatio: number | null;
      outgoingCount: number;
      incomingCount: number;
      score: number;
    };
    outcomeHistory: { types: string[]; adjustment: number };
    flags: string[];
  };
  scoredAt: string;
  cacheExpiresAt: string;
  disclaimer: string;
};

export type VouchClientOptions = {
  /**
   * Base URL of the Vouch REST API, including the `/api/v1` suffix.
   * Optional — defaults to the hosted production API, {@link DEFAULT_API_URL}.
   */
  apiUrl?: string;
  apiKey: string;
  fetch?: typeof fetch;
};

/**
 * Hosted production API. Used when `apiUrl` is omitted.
 *
 * 2026-08-13 (hackathon persona R2): `createVouchClient({ apiKey })` used to
 * throw a raw `TypeError: Cannot read properties of undefined (reading
 * 'replace')` from inside dist/index.js — the single most likely first line a
 * new integrator writes, failing with a stack trace that names none of our
 * options. The one URL that argument could sensibly take is this one, so it is
 * now the default instead of a crash.
 */
export const DEFAULT_API_URL = "https://vet402.com/api/v1";

/**
 * Error thrown when the Vouch API answers with a non-2xx status.
 *
 * `message` is the machine-readable code the API returned (e.g.
 * `missing_api_key`, `invalid_api_key`, `rate_limit_exceeded`) so existing
 * `err.message` checks keep working; `code` and `status` expose the same
 * facts without string parsing. SpendGuard uses them to tell "your key is
 * missing" apart from "the upstream is down".
 */
export class VouchApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "VouchApiError";
    this.code = code;
    this.status = status;
  }
}

export type X402PaymentAttestation = {
  wallet: string;
  txHash: string;
  amount?: string;
  network?: string;
  resource?: string;
};

export type BatchScoreItem =
  | { agentId: string; wallet?: string }
  | { wallet: string; agentId?: never };

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const AGENT_ID_RE = /^\d+$/;

export class VouchClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: VouchClientOptions) {
    const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    if (typeof apiUrl !== "string" || apiUrl.trim() === "") {
      throw new Error(
        "invalid_api_url: apiUrl must be a non-empty URL string " +
          `(e.g. "${DEFAULT_API_URL}") — omit it to use the hosted API`,
      );
    }
    if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
      throw new Error(
        "invalid_api_key: apiKey is required — create one at https://vet402.com/dashboard",
      );
    }
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetch ?? fetch;
  }

  getAgentScore(agentId: string, wallet?: string): Promise<TrustScoreResult> {
    assertAgentId(agentId);
    if (wallet) assertWallet(wallet);
    const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
    return this.request(`/agents/${agentId}/score${query}`);
  }

  getWalletScore(wallet: string): Promise<TrustScoreResult> {
    assertWallet(wallet);
    return this.request(`/wallets/${wallet}/score`);
  }

  /**
   * Buyer-side lookup: "should my agent pay this wallet?" — scores the
   * payment *recipient* (settlement receiving history, wallet health,
   * exit-scam-shaped outflow, outcome labels).
   */
  getPayeeScore(payee: string): Promise<PayeeScoreResult> {
    assertWallet(payee);
    return this.request(`/payees/${payee}/score`);
  }

  /**
   * Non-custodial spend-policy guard. Returns allow/deny decisions only —
   * never touches keys, funds, or transaction signing; execution remains the
   * agent's wallet stack's job (Coinbase AgentKit, Privy, ...). Fail-closed
   * by default (0.2.0): money moves only on a clean ALLOW verdict unless the
   * policy explicitly opts out via `trustPolicy`. The daily budget counter is
   * in-memory per guard instance and resets on process restart. See
   * SpendGuard for the full contract.
   */
  createSpendGuard(policy: SpendGuardPolicy): SpendGuard {
    return new SpendGuard(policy, (payee) => this.getPayeeScore(payee));
  }

  batchScore(agents: BatchScoreItem[]): Promise<{ results: unknown[] }> {
    if (!Array.isArray(agents) || agents.length === 0) {
      throw new Error("invalid_batch");
    }
    return this.request("/scores/batch", {
      method: "POST",
      body: JSON.stringify({ agents }),
    });
  }

  attestX402Payment(
    attestation: X402PaymentAttestation,
  ): Promise<{ ok: boolean; created: boolean; id: string }> {
    assertWallet(attestation.wallet);
    if (!TX_HASH_RE.test(attestation.txHash)) {
      throw new Error("invalid_tx_hash");
    }
    return this.request("/payments/x402", {
      method: "POST",
      body: JSON.stringify(attestation),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchFn(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code =
        typeof data === "object" && data && "error" in data
          ? String((data as { error: string }).error)
          : `vouch_api_error_${response.status}`;
      throw new VouchApiError(code, response.status);
    }
    return data as T;
  }
}

function assertAgentId(agentId: string): void {
  if (!AGENT_ID_RE.test(agentId)) throw new Error("invalid_agent_id");
}

function assertWallet(wallet: string): void {
  if (!WALLET_RE.test(wallet)) throw new Error("invalid_wallet_address");
}

export function createVouchClient(options: VouchClientOptions): VouchClient {
  return new VouchClient(options);
}
