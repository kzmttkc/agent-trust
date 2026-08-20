import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { rollupDailyMetrics } from "@/lib/observatory/metrics-rollup";
import { logServerError } from "@/lib/util/log";

// Phase 1.1 — 日次メトリクスのロールアップ。前日と当日の2日分を毎回叩く:
// 当日は途中集計の更新（冪等）、前日は日跨ぎ直後に取り漏らした分の確定。
// 2日より過去は backfill スクリプト（scripts/backfill-daily-metrics.ts）の
// 守備範囲で、cron が过去へ無限に手を伸ばさない。
export const maxDuration = 60;

function utcDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const days = [utcDay(-1), utcDay(0)];
    for (const day of days) await rollupDailyMetrics(day);
    return NextResponse.json({ ok: true, days });
  } catch (error) {
    logServerError("cron.metrics-rollup", error);
    return NextResponse.json({ ok: false, error: "rollup_failed" }, { status: 500 });
  }
}
