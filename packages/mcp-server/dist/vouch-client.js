const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const AGENT_ID_RE = /^\d+$/;
/**
 * Hosted production API — the default when VOUCH_API_URL is unset.
 *
 * 2026-08-13 (hackathon persona R2): this defaulted to
 * `http://localhost:3000/api/v1`. That is the right default for whoever is
 * developing this server and the wrong one for everybody who installs it: an
 * MCP client launched via `npx @vouchscore/mcp-server` with only a key set
 * would silently point at a port on the user's own machine and fail with a
 * connection error that names nothing. A published binary defaults to the
 * published API; local development sets the env var.
 */
const DEFAULT_API_URL = "https://vet402.com/api/v1";
function getConfig() {
    const apiUrl = process.env.VOUCH_API_URL ?? DEFAULT_API_URL;
    const apiKey = process.env.VOUCH_API_KEY;
    if (!apiKey) {
        throw new Error("VOUCH_API_KEY is required — create one at https://vet402.com/dashboard/keys " +
            "and set it in your MCP client's env block");
    }
    return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}
function assertAgentId(agentId) {
    if (!AGENT_ID_RE.test(agentId)) {
        throw new Error("invalid_agent_id");
    }
}
function assertWallet(wallet) {
    if (!WALLET_RE.test(wallet)) {
        throw new Error("invalid_wallet_address");
    }
}
export class VouchApiError extends Error {
    /** Present for some error codes (e.g. attestation_unverifiable) with a human-readable detail. */
    reason;
    constructor(code, reason) {
        super(code);
        this.name = "VouchApiError";
        this.reason = reason;
    }
}
async function vouchFetch(path, init) {
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
    return data;
}
export async function fetchAgentScore(agentId, wallet) {
    assertAgentId(agentId);
    if (wallet)
        assertWallet(wallet);
    const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
    return vouchFetch(`/agents/${agentId}/score${query}`);
}
export async function fetchWalletScore(wallet) {
    assertWallet(wallet);
    return vouchFetch(`/wallets/${wallet}/score`);
}
/** Buyer-side lookup: scores the payment *recipient* before an agent pays it. */
export async function fetchPayeeScore(payee) {
    assertWallet(payee);
    return vouchFetch(`/payees/${payee}/score`);
}
export async function attestX402Payment(attestation) {
    assertWallet(attestation.wallet);
    if (!TX_HASH_RE.test(attestation.txHash)) {
        throw new Error("invalid_tx_hash");
    }
    return vouchFetch("/payments/x402", {
        method: "POST",
        body: JSON.stringify(attestation),
    });
}
