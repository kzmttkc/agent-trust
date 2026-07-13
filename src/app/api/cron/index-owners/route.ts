import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { isProduction } from "@/lib/config/env";
import { indexOwnerAgents } from "@/lib/indexer/owner-indexer";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Production ignores attacker-controlled maxBlocks (RPC burn); use default chunk.
  const raw = request.nextUrl.searchParams.get("maxBlocks");
  const requested = raw ? Number(raw) : 150_000;
  const maxBlocks = isProduction()
    ? 150_000
    : Math.min(500_000, Math.max(1_000, Number.isFinite(requested) ? requested : 150_000));

  const result = await indexOwnerAgents({
    maxBlocks: BigInt(maxBlocks),
  });

  return NextResponse.json({ ok: true, ...result });
}
