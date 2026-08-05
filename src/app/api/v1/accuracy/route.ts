import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";
import { computeAccuracyReport } from "@/lib/scoring/accuracy";
import { fetchAccuracyRows } from "@/lib/db/outcome-reader";
import { logServerError } from "@/lib/util/log";

/**
 * GET /api/v1/accuracy — public, unauthenticated accuracy report.
 *
 * Public ON PURPOSE (2026-08-05 R&D): "of the ALLOW verdicts we issued, N%
 * later showed adverse activity" is only worth anything if anyone can fetch
 * it at any time — an accuracy number shown selectively is marketing, not
 * measurement. The report includes our false-positive rate on BLOCK verdicts
 * with the same prominence as the flattering number, and rates below the
 * minimum sample size are null rather than noise.
 *
 * No customer data on this path: the report is aggregate counts only — no
 * wallet addresses, no agent ids, no per-customer anything.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { body: unknown; expiresAt: number } | null = null;

export async function GET(request: NextRequest) {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.body, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
    });
  }

  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`accuracy:${ip}`, 20, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter ?? 60) } },
    );
  }

  try {
    const rows = await fetchAccuracyRows(90);
    const report = computeAccuracyReport(rows);
    const body = { ...report, windowDays: 90, generatedAt: new Date(now).toISOString() };
    cached = { body, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" },
    });
  } catch (error) {
    logServerError("accuracy_report", error);
    return NextResponse.json({ error: "accuracy_unavailable" }, { status: 503 });
  }
}
