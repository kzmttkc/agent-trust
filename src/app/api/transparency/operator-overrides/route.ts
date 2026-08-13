import { NextResponse } from "next/server";
import { listOperatorOverrides } from "@/lib/db/operator-overrides";

/**
 * GET /api/transparency/operator-overrides — the PUBLIC operator-override log.
 *
 * vet402 2026-08-14 (EF/Vitalik blocker). Every GLOBAL operator blacklist act is
 * published here: the address, what happened, why, and when. No key, no account,
 * no charge — a scored party (or anyone) can audit whether vet402 has censored an
 * address and on what stated grounds, and dispute it through the same keyless
 * routes as any score (ToS §8, /legal/terms#corrections). Customer-scoped lists
 * are never exposed here: those are a customer's private management right, not an
 * operator act of network-wide censorship.
 *
 * Read-only and non-custodial: this endpoint reports advice vet402 gave, it does
 * not move or hold anyone's funds.
 */
export const revalidate = 60;

export async function GET() {
  const overrides = await listOperatorOverrides();
  return NextResponse.json(
    {
      overrides,
      count: overrides.length,
      note:
        "Global operator overrides only. Customer-scoped lists are private to the customer and never appear here. " +
        "To dispute an entry, see /legal/terms#corrections — no account required.",
    },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
