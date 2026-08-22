import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { listOperatorOverrides, type OperatorOverrideEntry } from "@/lib/db/operator-overrides";

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

// 2026-08-22 audit: this was the only keyless public route with no IP rate
// limit. It looked covered by `export const revalidate = 60`, but a static
// route handler is only served from the prerender for requests WITHOUT a query
// string — `?nonce=1`, `?nonce=2`, … invoked the function and re-read the
// table every time. Reading the request to rate-limit makes the route dynamic,
// which would trade one problem for another, so both halves are handled:
//
//   - per-IP limit, 60/min, the same ceiling the other keyless read surface
//     (/api/badge/endpoint/[id]) uses;
//   - an in-process 60s memo of the query itself, so even a burst that stays
//     under the limit touches the database at most once a minute per instance;
//   - the same Cache-Control it always returned, so the CDN keeps absorbing
//     the ordinary (query-less) traffic exactly as before.
//
// The transparency guarantee is untouched: nothing here filters or delays what
// is published, it only bounds how often the same answer is recomputed.
export const dynamic = "force-dynamic";

const RL_LIMIT = 60;
const RL_WINDOW_MS = 60_000;
const MEMO_TTL_MS = 60_000;

let memo: { entries: OperatorOverrideEntry[]; expiresAt: number } | null = null;

async function readOverrides(): Promise<OperatorOverrideEntry[]> {
  if (memo && memo.expiresAt > Date.now()) return memo.entries;
  const entries = await listOperatorOverrides();
  memo = { entries, expiresAt: Date.now() + MEMO_TTL_MS };
  return entries;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const limited = await consumeIpRateLimit(`operator-overrides:${ip}`, RL_LIMIT, RL_WINDOW_MS);
  const perCaller = ipRateLimitHeaders(limited);
  if (!limited.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: perCaller });
  }

  const overrides = await readOverrides();
  return NextResponse.json(
    {
      overrides,
      count: overrides.length,
      note:
        "Global operator overrides only. Customer-scoped lists are private to the customer and never appear here. " +
        "To dispute an entry, see /legal/terms#corrections — no account required.",
    },
    { headers: { ...perCaller, "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
