import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidAddress, parseAgentId } from "@/lib/chain/client";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { persistPayeeScoreResult, persistScoreResult } from "@/lib/db/persistence";
import { logServerError } from "@/lib/util/log";
import { scoreAgentById } from "@/lib/scoring/engine";
import { scorePayeeWallet } from "@/lib/scoring/payee-engine";

const lookupSchema = z.object({
  agentId: z.string().optional(),
  wallet: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = lookupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { agentId, wallet } = parsed.data;
  if (!agentId && !wallet) {
    return NextResponse.json({ error: "agent_id_or_wallet_required" }, { status: 400 });
  }

  if (wallet && !isValidAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }

  if (agentId) {
    const id = parseAgentId(agentId);
    if (id === null) {
      return NextResponse.json({ error: "invalid_agent_id" }, { status: 400 });
    }
  }

  const auth = await authorizeDashboardRequest(request, 1);
  if (!auth.ok) return auth.error;

  const ctx = { apiKeyId: auth.ctx.apiKeyId };

  try {
    if (agentId) {
      const id = parseAgentId(agentId)!;
      const result = await scoreAgentById(id, { ...ctx, verifyWallet: wallet });
      void persistScoreResult(auth.ctx.apiKeyId, result).catch((error) =>
        logServerError("persist_score", error),
      );
      return NextResponse.json(result);
    }

    const result = await scorePayeeWallet(wallet!);
    void persistPayeeScoreResult(auth.ctx.apiKeyId, result).catch((error) =>
      logServerError("persist_score", error),
    );
    return NextResponse.json({ kind: "payee", ...result });
  } catch {
    return NextResponse.json({ error: "scoring_unavailable" }, { status: 503 });
  }
}
