const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const AGENT_ID_RE = /^\d+$/;
export class VouchClient {
    apiUrl;
    apiKey;
    fetchFn;
    constructor(options) {
        this.apiUrl = options.apiUrl.replace(/\/$/, "");
        this.apiKey = options.apiKey;
        this.fetchFn = options.fetch ?? fetch;
    }
    getAgentScore(agentId, wallet) {
        assertAgentId(agentId);
        if (wallet)
            assertWallet(wallet);
        const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
        return this.request(`/agents/${agentId}/score${query}`);
    }
    getWalletScore(wallet) {
        assertWallet(wallet);
        return this.request(`/wallets/${wallet}/score`);
    }
    batchScore(agents) {
        if (!Array.isArray(agents) || agents.length === 0) {
            throw new Error("invalid_batch");
        }
        return this.request("/scores/batch", {
            method: "POST",
            body: JSON.stringify({ agents }),
        });
    }
    attestX402Payment(attestation) {
        assertWallet(attestation.wallet);
        if (!TX_HASH_RE.test(attestation.txHash)) {
            throw new Error("invalid_tx_hash");
        }
        return this.request("/payments/x402", {
            method: "POST",
            body: JSON.stringify(attestation),
        });
    }
    async request(path, init) {
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
            throw new Error(typeof data === "object" && data && "error" in data
                ? String(data.error)
                : `vouch_api_error_${response.status}`);
        }
        return data;
    }
}
function assertAgentId(agentId) {
    if (!AGENT_ID_RE.test(agentId))
        throw new Error("invalid_agent_id");
}
function assertWallet(wallet) {
    if (!WALLET_RE.test(wallet))
        throw new Error("invalid_wallet_address");
}
export function createVouchClient(options) {
    return new VouchClient(options);
}
