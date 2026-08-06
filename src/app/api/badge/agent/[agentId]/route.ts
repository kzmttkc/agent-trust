import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { getDb } from "@/lib/db/client";
import { agentPassports } from "@/lib/db/schema";
import { parseAgentId } from "@/lib/chain/client";

// A-10 — embeddable SVG badge for an agent passport, the twin of the payee
// badge (/api/badge/[address]). States only what is true: "Verified agent"
// when a signed passport exists, otherwise "Unverified". No score in the badge
// — a cached score on third-party sites would outlive its freshness window.
export const revalidate = 3600;

// Key-less path: each distinct agentId is a cache-miss DB lookup and the id is
// attacker-chosen, so cap per IP. Generous — legit embeds serve from the CDN
// cache and never reach here.
const BADGE_LIMIT = 60;
const BADGE_WINDOW_MS = 60_000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`agent-badge:${ip}`, BADGE_LIMIT, BADGE_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: ipRateLimitHeaders(limited) },
    );
  }
  const { agentId: agentIdParam } = await params;
  const agentId = parseAgentId(agentIdParam.replace(/\.svg$/, ""));
  if (agentId === null) {
    return NextResponse.json({ error: "invalid_agent_id" }, { status: 400 });
  }
  let verified = false;
  const db = getDb();
  if (db) {
    try {
      const rows = await db
        .select({ agentId: agentPassports.agentId })
        .from(agentPassports)
        .where(eq(agentPassports.agentId, agentId))
        .limit(1);
      verified = rows.length > 0;
    } catch {
      verified = false;
    }
  }
  const label = verified ? "Verified agent" : "Unverified";
  const color = verified ? "#059669" : "#71717a";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="152" height="24" role="img" aria-label="Vouch: ${label}">
  <rect width="52" height="24" rx="4" fill="#18181b"/>
  <rect x="52" width="100" height="24" rx="4" fill="${color}"/>
  <rect x="52" width="6" height="24" fill="${color}"/>
  <text x="26" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11" fill="#ffffff">Vouch</text>
  <text x="102" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="10" fill="#ffffff">${label}</text>
</svg>`;
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
