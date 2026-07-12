const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const AGENT_ID_RE = /^\d+$/;
function getConfig() {
    const apiUrl = process.env.VOUCH_API_URL ?? "http://localhost:3000/api/v1";
    const apiKey = process.env.VOUCH_API_KEY;
    if (!apiKey) {
        throw new Error("VOUCH_API_KEY is required");
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
async function vouchFetch(path) {
    const { apiUrl, apiKey } = getConfig();
    const response = await fetch(`${apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error ?? `vouch_api_error_${response.status}`);
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
