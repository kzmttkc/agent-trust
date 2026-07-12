import { NextRequest, NextResponse } from "next/server";
import {
  applyRateLimit,
  authenticateApiRequest,
  withRateLimitHeaders,
} from "@/lib/api/guard";
import { isValidAddress } from "@/lib/chain/client";
import { persistScoreResult } from "@/lib/db/persistence";
import { logServerError } from "@/lib/util/log";
import { scoreWallet } from "@/lib/scoring/engine";

type RouteContext = { params: Promise<{ address: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.error;

  const { address } = await context.params;
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }

  const limited = await applyRateLimit(auth.ctx, 1);
  if (!limited.ok) return limited.error;

  try {
    const result = await scoreWallet(address, { apiKeyId: auth.ctx.apiKeyId });
    void persistScoreResult(auth.ctx.apiKeyId, result).catch((error) =>
      logServerError("persist_score", error),
    );

    return withRateLimitHeaders(NextResponse.json(result), limited.rateLimit);
  } catch {
    return NextResponse.json({ error: "scoring_unavailable" }, { status: 503 });
  }
}
