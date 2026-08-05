// ============================================================
// Vouch facilitator gate — N-19 reference adapter (2026-08-05).
//
// Drop-in pre-settlement hook for an x402 facilitator: before you settle a
// payment, ask Vouch whether the payee should be trusted. Fail-closed by
// default — if Vouch is unreachable, the payment is NOT settled (flip
// FAIL_OPEN=1 only if you accept that risk).
//
// Usage (Node 18+, zero deps):
//   VOUCH_API_KEY=vk_... node index.mjs 0xPayeeAddress
// or import { gateSettlement } from this file inside your facilitator.
// ============================================================

const VOUCH_URL = process.env.VOUCH_URL ?? "https://agent-trust-tawny.vercel.app";
const FAIL_OPEN = process.env.FAIL_OPEN === "1";

/**
 * @param {string} payee 0x wallet address that will receive the settlement
 * @returns {Promise<{settle: boolean, reason: string, score?: number}>}
 */
export async function gateSettlement(payee) {
  const apiKey = process.env.VOUCH_API_KEY;
  if (!apiKey) return { settle: FAIL_OPEN, reason: "vouch_api_key_missing" };
  try {
    const res = await fetch(`${VOUCH_URL}/api/v1/wallets/${payee}/score`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { settle: FAIL_OPEN, reason: `vouch_http_${res.status}` };
    const body = await res.json();
    // BLOCK and WARN both halt auto-settlement; WARN can be routed to a
    // manual queue instead if your facilitator has one.
    const settle = body.recommendation === "ALLOW";
    return { settle, reason: `vouch_${body.recommendation}`, score: body.trustScore };
  } catch {
    return { settle: FAIL_OPEN, reason: "vouch_unreachable" };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const payee = process.argv[2];
  if (!payee) {
    console.error("usage: VOUCH_API_KEY=vk_... node index.mjs 0xPayeeAddress");
    process.exit(2);
  }
  const verdict = await gateSettlement(payee);
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.settle ? 0 : 1);
}
