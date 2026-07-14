import { isSkipChainReadsEnabled } from "@/lib/config/env";
import { getPublicClient } from "./client";

/** keccak256("Transfer(address,address,uint256)") — standard ERC20 Transfer event. */
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type X402VerifyResult =
  | { ok: true }
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
    return { ok: true };
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
    return { ok: true };
  }

  const logMatches = receipt.logs.some((log) => {
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 !== TRANSFER_TOPIC) return false;
    const fromTopic = log.topics[1];
    if (!fromTopic) return false;
    return topicToAddress(fromTopic) === walletLower;
  });

  if (logMatches) return { ok: true };

  return { ok: false, reason: "wallet_mismatch" };
}
