import { NextRequest, NextResponse } from "next/server";
import {
  applyRateLimit,
  authenticateApiRequest,
  withRateLimitHeaders,
} from "@/lib/api/guard";
import { isValidAddress, parseAgentId } from "@/lib/chain/client";
import { persistScoreResult } from "@/lib/db/persistence";
import { logServerError } from "@/lib/util/log";
import { scoreAgentById } from "@/lib/scoring/engine";

type RouteContext = { params: Promise<{ agentId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.error;

  const { agentId: agentIdParam } = await context.params;
  const agentId = parseAgentId(agentIdParam);
  if (agentId === null) {
    return NextResponse.json({ error: "invalid_agent_id" }, { status: 400 });
  }

  const verifyWallet = request.nextUrl.searchParams.get("wallet") ?? undefined;
  if (verifyWallet && !isValidAddress(verifyWallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }

  const limited = await applyRateLimit(auth.ctx, 1);
  if (!limited.ok) return limited.error;

  try {
    const result = await scoreAgentById(agentId, {
      apiKeyId: auth.ctx.apiKeyId,
      verifyWallet,
    });

    void persistScoreResult(auth.ctx.apiKeyId, result).catch((error) =>
      logServerError("persist_score", error),
    );

    return withRateLimitHeaders(NextResponse.json(result), limited.rateLimit);
  } catch (error) {
    logServerError("score_agent", error);
    return NextResponse.json({ error: "scoring_unavailable" }, { status: 503 });
  }
}
