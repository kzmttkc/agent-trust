import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { runDemoL0 } from "@/lib/demo/verify";
import { logServerError } from "@/lib/util/log";

/**
 * POST /api/v1/demo/verify — /playground のライブL0検証（Phase 0.1）。
 *
 * キー無し・IPレート制限のみの公開デモ呼び口。カタログの1エンドポイントへ
 * その場で L0 プローブを撃ち、結果をそのまま返す。公開台帳へは書かない
 * （デモが測定ケイデンスを汚さない——src/lib/demo/verify.ts 冒頭を参照）。
 *
 * ライブの外向きHTTPを1リクエスト誘発するため、レート制限は他の
 * 公開GETより一段きつい 5回/分。プローブ自体のSSRFガードは
 * probeEndpoint 側（createSafeFetchImpl）が持つ。
 */

const RL_LIMIT = 5;
const RL_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`demo-verify:${ip}`, RL_LIMIT, RL_WINDOW_MS);
  const perCaller = ipRateLimitHeaders(limited);
  if (!limited.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: perCaller });
  }

  let endpointId: unknown;
  try {
    const body = await request.json();
    endpointId = (body as { endpointId?: unknown })?.endpointId;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: perCaller });
  }
  if (typeof endpointId !== "string" || endpointId.length === 0) {
    return NextResponse.json({ error: "endpoint_id_required" }, { status: 400, headers: perCaller });
  }

  try {
    const result = await runDemoL0(endpointId);
    if (!result.ok) {
      if (result.reason === "db_unavailable") {
        return NextResponse.json({ error: "demo_unavailable" }, { status: 503, headers: perCaller });
      }
      return NextResponse.json({ error: result.reason }, { status: 404, headers: perCaller });
    }
    // ライブ実測は共有キャッシュに載せない（毎回いまの状態を見せるのがデモの価値）。
    return NextResponse.json(result, {
      headers: { ...perCaller, "Cache-Control": "no-store" },
    });
  } catch (error) {
    logServerError("demo_verify", error);
    return NextResponse.json({ error: "demo_unavailable" }, { status: 503, headers: perCaller });
  }
}
