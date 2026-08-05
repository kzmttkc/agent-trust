import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { verifiedPayees } from "@/lib/db/schema";
import { isValidAddress } from "@/lib/chain/client";

// N-16 — embeddable SVG badge. States only what is true: "Verified payee"
// when a signed claim exists, otherwise "Unverified". No score in the badge
// (a cached score on third-party sites would outlive its freshness window).
export const revalidate = 3600;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="24" role="img" aria-label="Vouch: ${label}">
  <rect width="52" height="24" rx="4" fill="#18181b"/>
  <rect x="52" width="98" height="24" rx="4" fill="${color}"/>
  <rect x="52" width="6" height="24" fill="${color}"/>
  <text x="26" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="11" fill="#ffffff">Vouch</text>
  <text x="100" y="16" text-anchor="middle" font-family="Verdana,sans-serif" font-size="10" fill="#ffffff">${label}</text>
</svg>`;
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
