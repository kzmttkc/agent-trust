import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { scoreAgentById } from "@/lib/scoring/engine";
import { logServerError } from "@/lib/util/log";

/**
 * GET /api/demo/score — the one unauthenticated score on the site.
 *
 * WHY (2026-08-05 R&D): the homepage showed a hard-coded "sample response".
 * For a product whose entire pitch is "our score is computed from real chain
 * data", a fabricated 78 is the weakest possible first impression — a visitor
 * cannot tell it from marketing fiction, because it is marketing fiction.
 * This endpoint scores ONE fixed, publicly registered ERC-8004 agent so the
 * homepage can show a number that was actually computed, timestamped, and
 * re-computed while you watch.
 *
 * Abuse posture, in order:
 *   1. The agent id is fixed server-side (env DEMO_AGENT_ID, default 1).
 *      Nothing the caller sends selects what gets scored — this is a demo,
 *      not a free lookup API.
 *   2. Cross-request result cache (module scope, 5 min — same TTL as the
 *      scoring engine's own cache) so a page-view storm costs zero RPC.
 *   3. IP rate limit as the backstop for cache-miss storms.
 *   4. Everything returned is derived from public chain state; there is no
 *      customer data on this path (no apiKeyId → no manual lists).
 *
 * Failure posture: this endpoint must never look better than the truth.
 * If the score cannot be computed, it says so ({ live: false }) and the page
 * keeps its clearly-labelled static sample — it does NOT serve a stale
 * number as if it were fresh beyond the cache window.
 */

const DEMO_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT = 10; // per IP per minute — humans reloading, not scrapers
const RATE_WINDOW_MS = 60 * 1000;
// 2026-08-06 UX audit: a hang inside scoreAgentById (e.g. a slow/unreachable
// RPC several calls deep) is not a rejection, so the try/catch below never
// fires and the request hangs until the platform kills it (504, reproduced
// 3/3 by a persona audit and independently by curl — timeout, not error).
// This endpoint's own contract is "must never look better than the truth,"
// which a hang violates worse than a fast { live: false } ever could. Race
// against a timeout well under Vercel's function limit so a slow dependency
// degrades to the documented failure response instead of hanging the page.
const SCORE_TIMEOUT_MS = 8_000;

type DemoPayload = {
  live: true;
  agentId: string;
  trustScore: number;
  recommendation: string;
  walletAgeDays: number;
  x402PaymentCount: number;
  sybilRisk: string;
  registered: boolean;
  scoredAt: string;
};

let cached: { payload: DemoPayload; expiresAt: number } | null = null;

function demoAgentId(): bigint {
  try {
    return BigInt(process.env.DEMO_AGENT_ID ?? "1");
  } catch {
    return BigInt(1);
  }
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  }

  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`demo-score:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limited.allowed) {
    // 2026-08-06: emit the full RateLimit-* set (not just Retry-After) so the
    // key-less paths share one visible contract.
    return NextResponse.json(
      { live: false, reason: "rate_limited" },
      { status: 429, headers: ipRateLimitHeaders(limited) },
    );
  }

  try {
    const result = await Promise.race([
      scoreAgentById(demoAgentId()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("demo_score_timeout")), SCORE_TIMEOUT_MS),
      ),
    ]);
    const payload: DemoPayload = {
      live: true,
      agentId: result.agentId,
      trustScore: result.trustScore,
      recommendation: result.recommendation,
      walletAgeDays: result.signals.wallet.ageDays,
      x402PaymentCount: result.signals.x402.paymentCount,
      sybilRisk: result.signals.sybil.risk,
      registered: result.signals.identity.registered,
      scoredAt: result.scoredAt,
    };
    cached = { payload, expiresAt: now + DEMO_TTL_MS };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    logServerError("demo_score", error);
    return NextResponse.json(
      { live: false, reason: "unavailable" },
      { status: 200, headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  }
}
