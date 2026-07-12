import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { purgeExpiredLogs } from "@/lib/cron/log-retention";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await purgeExpiredLogs();
  return NextResponse.json({ ok: true, ...result });
}
