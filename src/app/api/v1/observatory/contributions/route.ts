import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { submitContribution } from "@/lib/observatory/contributions";
import { logServerError } from "@/lib/util/log";

/**
 * POST /api/v1/observatory/contributions — 外部L0観測の受け取り（Phase 3.3 v0）。
 * 既定OFF（CONTRIBUTIONS_ENABLED）。受理しても公開verdictには混ぜない——
 * v0は署名付き保存のみ（src/lib/observatory/contributions.ts 冒頭）。
 */

const RL_LIMIT = 10;
const RL_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`contributions:${ip}`, RL_LIMIT, RL_WINDOW_MS);
  const perCaller = ipRateLimitHeaders(limited);
  if (!limited.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: perCaller });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: perCaller });
  }

  try {
    const result = await submitContribution({
      endpointId: typeof body.endpointId === "string" ? body.endpointId : "",
      verdict: typeof body.verdict === "string" ? body.verdict : "",
      httpStatus: typeof body.httpStatus === "number" ? body.httpStatus : null,
      latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : null,
      address: typeof body.address === "string" ? body.address : "",
      signature: typeof body.signature === "string" ? body.signature : "",
    });
    if (!result.ok) {
      const status =
        result.reason === "contributions_disabled"
          ? 403
          : result.reason === "db_unavailable"
            ? 503
            : 400;
      return NextResponse.json({ error: result.reason }, { status, headers: perCaller });
    }
    return NextResponse.json(
      {
        ok: true,
        id: result.id,
        note: "Recorded. v0 contributions are stored and audited; they are NOT folded into published verdicts.",
      },
      { status: 201, headers: perCaller },
    );
  } catch (error) {
    logServerError("contributions", error);
    return NextResponse.json({ error: "contributions_unavailable" }, { status: 503, headers: perCaller });
  }
}
