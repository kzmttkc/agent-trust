import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { detectOutcomes } from "@/lib/indexer/outcome-detector";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  const result = await detectOutcomes({ limit: Math.min(200, Math.max(1, limit)) });

  return NextResponse.json({ ok: true, ...result });
}
