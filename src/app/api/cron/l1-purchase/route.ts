import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { runL1Batch } from "@/lib/observatory/l1-runner";
import { logServerError } from "@/lib/util/log";

// vet402 Observatory L1 — daily covert-purchase batch (design §5 W3).
// The weekly full sweep of the real-demand set emerges from the daily $25
// budget, not from a scheduler: each firing walks the highest-demand
// endpoints not purchased in the last 6 days and stops at the budget line.
// Dark-launch safe: with OBSERVATORY_L1_ENABLED unset or the wallet key
// absent, the batch refuses before any network traffic (tested).
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const summary = await runL1Batch();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    logServerError("cron.l1-purchase", error);
    return NextResponse.json({ ok: false, error: "l1_failed" }, { status: 500 });
  }
}
