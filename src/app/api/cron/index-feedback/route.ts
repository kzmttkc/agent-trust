import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { isProduction } from "@/lib/config/env";
import { indexFeedbackEvents } from "@/lib/indexer/feedback-indexer";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Production ignores attacker-controlled maxBlocks (RPC burn); use default.
  // 400k covers the 8-day bootstrap (~345,600 blocks) in a single run and
  // leaves margin for catching up after a missed daily run, while staying far
  // inside the 300s budget — Base produces ~43,200 blocks a day, so steady
  // state needs a tenth of this.
  const raw = request.nextUrl.searchParams.get("maxBlocks");
  const requested = raw ? Number(raw) : 400_000;
  const maxBlocks = isProduction()
    ? 400_000
    : Math.min(1_000_000, Math.max(1_000, Number.isFinite(requested) ? requested : 400_000));

  const result = await indexFeedbackEvents({ maxBlocks: BigInt(maxBlocks) });

  return NextResponse.json({ ok: true, ...result });
}
