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
  // 40k blocks took ~6s end-to-end once GET_LOGS_CHUNK_BLOCKS/DELAY_MS were
  // fixed (2026-07-22 incident — stale values from the old rate-limited RPC
  // key were forcing hundreds of tiny sequential chunks). 250k gives wide
  // margin under the 300s budget while actually outpacing Base's ~43k
  // blocks/day production rate enough to close the historical backlog
  // within a handful of daily (Hobby-plan-capped) runs instead of never.
  const raw = request.nextUrl.searchParams.get("maxBlocks");
  const requested = raw ? Number(raw) : 250_000;
  const maxBlocks = isProduction()
    ? 250_000
    : Math.min(500_000, Math.max(1_000, Number.isFinite(requested) ? requested : 250_000));

  const result = await indexOwnerAgents({
    maxBlocks: BigInt(maxBlocks),
  });

  return NextResponse.json({ ok: true, ...result });
}
