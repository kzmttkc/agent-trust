import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { getDb } from "@/lib/db/client";
import { verifiedPayees } from "@/lib/db/schema";
import { isValidAddress } from "@/lib/chain/client";

// N-16 — embeddable SVG badge. States only what is true: "Verified payee"
// when a signed claim exists, otherwise "Unverified". No score in the badge
// (a cached score on third-party sites would outlive its freshness window).
export const revalidate = 3600;

// 2026-08-06 security (self-audit item 1): key-less path. Each distinct
// address is a cache-miss that costs a DB lookup, and the address is
// attacker-chosen (unlike a CDN-cached hit), so an unbounded /api/badge/:addr
// loop over fresh addresses bypasses the cache entirely. Cap per IP. Generous
// because legit embeds are served from the CDN cache and never reach here.
const BADGE_LIMIT = 60;
const BADGE_WINDOW_MS = 60_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`badge:${ip}`, BADGE_LIMIT, BADGE_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: ipRateLimitHeaders(limited) },
    );
  }
  const { address } = await params;
  const clean = address.replace(/\.svg$/, "");
  if (!isValidAddress(clean)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  let verified = false;
  const db = getDb();
  if (db) {
    try {
      const rows = await db
        .select({ wallet: verifiedPayees.wallet })
        .from(verifiedPayees)
        .where(eq(verifiedPayees.wallet, clean.toLowerCase()))
        .limit(1);
      verified = rows.length > 0;
    } catch {
      verified = false;
    }
  }
  const label = verified ? "Verified payee" : "Unverified";
  const color = verified ? "#059669" : "#71717a";
  // 2026-08-13 rename: "Vouch" (5 chars, ~34px at Verdana 11px) → "vet402"
  // (6 chars, ~38px). Left segment widened 52→58 so the padding stays ~10px
  // per side; every x downstream shifts by +6 (total width 150→156).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="156" height="24" role="img" aria-label="vet402: ${label}">
  <rect width="58" height="24" rx="4" fill="#18181b"/>
  <rect x="58" width="98" height="24" rx="4" fill="${color}"/>
  <rect x="58" width="6" height="24" fill="${color}"/>
  <text x="29" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11" fill="#ffffff">vet402</text>
  <text x="107" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="10" fill="#ffffff">${label}</text>
</svg>`;
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
