import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { runL0ProbeBatch } from "@/lib/observatory/probe-runner";
import { drainVerificationRequests } from "@/lib/observatory/requests";
import { logServerError } from "@/lib/util/log";

// vet402 Observatory L0 — rolling no-purchase probe. One daily firing probes
// the ~500 endpoints whose last probe is oldest; the catalog cycles in a few
// days. Worst case (all 500 hit the 10s timeout at concurrency 20) is 250s —
// inside the 300s ceiling by design, not by luck.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // 公開キュー（C9）を先に消化——リクエストは順番を早めるだけで、
    // 判定ゲートは通常プローブと同一（requests.ts 冒頭）。
    const requests = await drainVerificationRequests(50);
    const summary = await runL0ProbeBatch();
    return NextResponse.json({ ok: true, requests, ...summary });
  } catch (error) {
    logServerError("cron.l0-probe", error);
    return NextResponse.json({ ok: false, error: "probe_failed" }, { status: 500 });
  }
}
