import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest, withRateLimitHeaders } from "@/lib/api/guard";
import { isValidAddress } from "@/lib/chain/client";
import { scorePayeeWallet } from "@/lib/scoring/payee-engine";
import { logServerError } from "@/lib/util/log";

type RouteContext = { params: Promise<{ address: string }> };

/**
 * GET /api/v1/payees/{address}
 *
 * Buyer-side counterpart to /v1/wallets/{address}/score and
 * /v1/agents/{agentId}/score: those answer "should I accept payment from
 * this agent/wallet?" (seller-side screening); this answers "should my
 * agent pay this wallet?" (buyer-side screening before an x402 payment is
 * sent). Never 404s for an unfamiliar wallet — data-poor wallets still get
 * a 200 with `dataDepth: "thin"` so callers can weigh the score's
 * confidence themselves, mirroring the existing dataCoverage pattern.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, 1);
  if (!auth.ok) return auth.error;

  const { address } = await context.params;
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }

  try {
    const result = await scorePayeeWallet(address);
    return withRateLimitHeaders(NextResponse.json(result), auth.ctx.rateLimit);
  } catch (error) {
    logServerError("score_payee", error);
    return NextResponse.json({ error: "scoring_unavailable" }, { status: 503 });
  }
}
