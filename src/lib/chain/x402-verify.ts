import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { getPublicClient } from "./client";

/** keccak256("Transfer(address,address,uint256)") — standard ERC20 Transfer event. */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * How the payee address was resolved from the receipt:
 *  - "exact": a single Transfer leg with the payer as `from` — unambiguous.
 *  - "ambiguous": multiple payer-originated Transfer legs (e.g. a fee split);
 *    the largest-amount leg was chosen as the settlement body.
 *  - "fallback": no payer-originated leg matched; resolved via any Transfer
 *    log's `to` or `receipt.to` — lower confidence, may be a facilitator.
 * Log/observability only — never persisted alongside the payment row.
 */
export type PayeeConfidence = "exact" | "ambiguous" | "fallback";

export type X402VerifyResult =
  | { ok: true; payee: string | null; payeeConfidence: PayeeConfidence }
  | {
      ok: false;
      reason:
        | "unsupported_network"
        | "tx_not_found"
        | "tx_not_success"
        | "wallet_mismatch"
        | "rpc_unavailable";
    };

function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

/**
 * Best-effort extraction of the receiving wallet (payee) from a verified
 * receipt. Reuses the same ERC20 Transfer logs the wallet-match check above
 * already parses, so this never issues extra RPC calls.
 *
 * Preference order:
 *  1. The `to` topic of the Transfer log whose `from` topic matches the payer
 *     wallet — the direct settlement leg (`payeeConfidence: "exact"`). When
 *     *multiple* payer-originated legs exist (e.g. a fee split where the
 *     payer funds both the merchant and a fee collector), the leg with the
 *     largest transfer amount is taken as the settlement body — fee legs are
 *     smaller than the body by construction — and the result is marked
 *     `"ambiguous"` so callers can log it.
 *  2. The `to` topic of any Transfer log in the receipt, if none matched (1)
 *     — covers the facilitator/meta-transaction path where the payer never
 *     appears as `from` on-chain (the relayer does), but a settlement
 *     transfer still happened (`"fallback"`).
 *  3. `receipt.to` (the transaction's direct recipient) as a last resort —
 *     covers plain native-token transfers with no ERC20 Transfer log at all.
 *     May be a contract address (e.g. a facilitator) rather than the final
 *     recipient (`"fallback"`).
 *
 * `payee` is null only when none of the above yields an address (e.g. a
 * contract-creation transaction with no logs).
 */
export function extractPayeeFromReceipt(
  receipt: {
    to: string | null;
    logs: readonly { topics: readonly string[]; data?: string }[];
  },
  walletLower: string,
): { payee: string | null; confidence: PayeeConfidence } {
  const transferLogs = receipt.logs.filter(
    (log) => log.topics[0]?.toLowerCase() === TRANSFER_TOPIC,
  );

  const directLegs = transferLogs.filter((log) => {
    const fromTopic = log.topics[1];
    if (!fromTopic || !log.topics[2]) return false;
    return topicToAddress(fromTopic) === walletLower;
  });

  if (directLegs.length === 1) {
    return { payee: topicToAddress(directLegs[0].topics[2]!), confidence: "exact" };
  }
  if (directLegs.length > 1) {
    const largest = directLegs.reduce((best, log) =>
      transferAmount(log.data) > transferAmount(best.data) ? log : best,
    );
    return { payee: topicToAddress(largest.topics[2]!), confidence: "ambiguous" };
  }

  const anyLeg = transferLogs.find((log) => Boolean(log.topics[2]));
  if (anyLeg?.topics[2]) {
    return { payee: topicToAddress(anyLeg.topics[2]), confidence: "fallback" };
  }

  return { payee: receipt.to?.toLowerCase() ?? null, confidence: "fallback" };
}

/**
 * ERC20 Transfer amount lives in the log's non-indexed `data` field. Treat
 * anything unparseable (missing, "0x", non-hex) as 0 rather than throwing —
 * this is a tiebreak, not a validation gate.
 */
function transferAmount(data: string | undefined): bigint {
  if (!data || data === "0x") return 0n;
  try {
    return BigInt(data);
  } catch {
    return 0n;
  }
}

/**
 * Confirms an x402 settlement attestation corresponds to a real, successful
 * Base transaction attributable to the claimed wallet before it is written
 * to the DB and weighted into the trust score.
 *
 * Matches on either:
 *  - `receipt.from` (direct submission by the payer wallet), or
 *  - the `from` topic of an ERC20 `Transfer` log in the receipt (facilitator
 *    / meta-transaction submission pattern used by x402 relayers, where the
 *    wallet signs an authorization but a relayer broadcasts the tx).
 *
 * Fail-closed: any RPC error, missing receipt, non-success status, or lack
 * of a wallet match is treated as unverifiable and MUST be rejected by the
 * caller. Never record an attestation we could not independently confirm.
 */
export async function verifyX402PaymentOnChain(
  txHash: `0x${string}`,
  wallet: string,
  network: string,
): Promise<X402VerifyResult> {
  if (network.toLowerCase() !== "base") {
    // Only Base is wired up to an RPC client today; we cannot verify other
    // networks, so refuse rather than accept unverified attestations.
    return { ok: false, reason: "unsupported_network" };
  }

  if (isSkipChainReadsEnabled()) {
    return { ok: true, payee: null, payeeConfidence: "fallback" };
  }

  const walletLower = wallet.toLowerCase();
  const client = getPublicClient();

  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    // Covers "receipt not found" (tx doesn't exist / not yet mined) as well
    // as RPC/network failures. Fail-closed either way.
    return { ok: false, reason: "tx_not_found" };
  }

  if (!receipt || receipt.status !== "success") {
    return { ok: false, reason: "tx_not_success" };
  }

  if (receipt.from?.toLowerCase() === walletLower) {
    return okWithPayee(receipt, walletLower, txHash);
  }

  const logMatches = receipt.logs.some((log) => {
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 !== TRANSFER_TOPIC) return false;
    const fromTopic = log.topics[1];
    if (!fromTopic) return false;
    return topicToAddress(fromTopic) === walletLower;
  });

  if (logMatches) {
    return okWithPayee(receipt, walletLower, txHash);
  }

  return { ok: false, reason: "wallet_mismatch" };
}

function okWithPayee(
  receipt: { to: string | null; logs: readonly { topics: readonly string[]; data?: string }[] },
  walletLower: string,
  txHash: string,
): X402VerifyResult {
  const { payee, confidence } = extractPayeeFromReceipt(receipt, walletLower);
  if (confidence === "ambiguous") {
    console.warn(
      `[vouch] x402_payee_ambiguous: tx ${txHash} has multiple payer-originated ` +
        `Transfer legs; picked largest-amount leg ${payee ?? "unknown"} as payee`,
    );
  }
  return { ok: true, payee, payeeConfidence: confidence };
}
