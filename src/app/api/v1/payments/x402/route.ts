import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyRateLimit,
  authenticateApiRequest,
  withRateLimitHeaders,
} from "@/lib/api/guard";
import { isValidAddress } from "@/lib/chain/client";
import { verifyX402PaymentOnChain } from "@/lib/chain/x402-verify";
import { recordX402Payment } from "@/lib/db/x402-payments";
import { invalidateScoreCacheForListChange } from "@/lib/scoring/cache-invalidation";
import { invalidatePayeeScoreCache } from "@/lib/scoring/payee-engine";
import { logServerError } from "@/lib/util/log";

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

const bodySchema = z.object({
  wallet: z.string().min(1),
  txHash: z.string().min(1),
  amount: z.string().max(78).optional(),
  network: z.string().max(32).optional(),
  resource: z.string().max(512).optional(),
});

/**
 * POST /api/v1/payments/x402
 *
 * Provider write-back after x402 payment verification.
 * Idempotent on txHash. Weights into trust score (SCORE_WEIGHTS.x402).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.error;

  const limited = await applyRateLimit(auth.ctx, 1);
  if (!limited.ok) return limited.error;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { wallet, txHash, amount, network, resource } = parsed.data;

  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }
  if (!TX_HASH_RE.test(txHash)) {
    return NextResponse.json({ error: "invalid_tx_hash" }, { status: 400 });
  }

  const resolvedNetwork = network ?? "base";

  // Anyone can POST a well-formed wallet + regex-shaped txHash; without an
  // on-chain check that would be enough to fabricate settlement history for
  // an arbitrary wallet. Verify the tx is real, succeeded, and is actually
  // attributable to the claimed wallet before it can influence trust scores.
  // Fail-closed: any RPC failure or mismatch is rejected, never recorded.
  const verification = await verifyX402PaymentOnChain(
    txHash as `0x${string}`,
    wallet,
    resolvedNetwork,
  );
  if (!verification.ok) {
    return NextResponse.json(
      { error: "attestation_unverifiable", reason: verification.reason },
      { status: 422 },
    );
  }

  try {
    const result = await recordX402Payment({
      wallet,
      txHash,
      amount: amount ?? null,
      apiKeyId: auth.ctx.apiKeyId,
      network: resolvedNetwork,
      resource: resource ?? null,
      payee: verification.payee,
    });

    if (result.created) {
      void invalidateScoreCacheForListChange(wallet).catch((error) =>
        logServerError("x402_cache_invalidate", error),
      );
      if (verification.payee) {
        invalidatePayeeScoreCache(verification.payee);
      }
    }

    return withRateLimitHeaders(
      NextResponse.json(
        {
          ok: true,
          created: result.created,
          id: result.id,
          wallet: wallet.toLowerCase(),
          txHash: txHash.toLowerCase(),
          payee: verification.payee,
        },
        { status: result.created ? 201 : 200 },
      ),
      limited.rateLimit,
    );
  } catch (error) {
    logServerError("x402_payment_ingest", error);
    return NextResponse.json({ error: "payment_ingest_unavailable" }, { status: 503 });
  }
}
