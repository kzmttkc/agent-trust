import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { indexOwnerAgents } from "@/lib/indexer/owner-indexer";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const maxBlocks = Number(request.nextUrl.searchParams.get("maxBlocks") ?? 150_000);
  const result = await indexOwnerAgents({
    maxBlocks: BigInt(Math.min(500_000, Math.max(1_000, maxBlocks))),
  });

  return NextResponse.json({ ok: true, ...result });
}
