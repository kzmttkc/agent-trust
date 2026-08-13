import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyMessage } from "viem";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit, ipRateLimitHeaders } from "@/lib/api/ip-rate-limit";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/pg-errors";
import { verifiedPayees } from "@/lib/db/schema";
import { isValidAddress } from "@/lib/chain/client";
import { logServerError } from "@/lib/util/log";
// 2026-08-14: isCanonicalName/NAME_MAX_LENGTH moved to @/lib/validation so a
// route file no longer exports a shared helper (Next 16 route-type contract).
import { isCanonicalName } from "@/lib/validation/canonical-name";

// N-16 — payee self-verification. Sign the canonical message with the payee
// wallet; a valid signature IS the proof of control (EIP-191 via viem, which
// also handles smart accounts per EIP-6492 where supported). No API key
// required: registering yourself as a payee should have zero friction, and
// the signature requirement is the anti-abuse gate.
//
// SECURITY: callers MUST validate `name` with isCanonicalName() before calling
// this. The throw is a defense-in-depth backstop so a non-canonical name can
// never be silently folded into the signed message even via a future caller.
export function payeeMessage(wallet: string, name: string): string {
  if (!isCanonicalName(name)) {
    throw new Error("payeeMessage: non-canonical name would break the 4-line canonical message");
  }
  return [
    "Vouch verified payee registration",
    `wallet: ${wallet.toLowerCase()}`,
    `name: ${name}`,
    "This signature only proves control of the wallet above.",
  ].join("\n");
}

const schema = z.object({
  wallet: z.string(),
  // Canonical name enforced at the schema layer: single-line, trimmed, no
  // control chars, <= NAME_MAX_LENGTH. See isCanonicalName above for why.
  name: z.string().refine(isCanonicalName, { message: "invalid_name" }),
  url: z.string().url().max(200).optional(),
  signature: z.string().max(4000),
});

// Key-less path rate limits (item 1). The write path (POST) is stricter than
// the read/preview path (GET), and POST additionally caps per-wallet churn so
// one wallet cannot rewrite its public profile in a hot loop even from many IPs.
const GET_LIMIT = 30;
const POST_IP_LIMIT = 8;
const POST_WALLET_LIMIT = 4;
const RL_WINDOW_MS = 60_000;

// Preview the exact canonical message for a given (wallet, name) pair, so a
// caller can construct + sign it before ever attempting POST. Read-only, but
// still rate-limited: it is key-less and does DB-free work an abuser could
// hammer, and integrators benefit from seeing the same RateLimit-* contract.
export async function GET(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`payee-verify-get:${ip}`, GET_LIMIT, RL_WINDOW_MS);
  const rlHeaders = ipRateLimitHeaders(limited);
  if (!limited.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: rlHeaders });
  }

  const wallet = request.nextUrl.searchParams.get("wallet") ?? "";
  const name = request.nextUrl.searchParams.get("name") ?? "";
  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400, headers: rlHeaders });
  }
  if (!isCanonicalName(name)) {
    // Same rule the signer enforces: reject newlines/tabs/control chars and
    // over-length here so a caller cannot preview a message the POST would
    // reject, and cannot smuggle extra "wallet:" lines into the preview.
    return NextResponse.json({ error: "invalid_name" }, { status: 400, headers: rlHeaders });
  }
  return NextResponse.json({ message: payeeMessage(wallet, name) }, { headers: rlHeaders });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`payee-verify:${ip}`, POST_IP_LIMIT, RL_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: ipRateLimitHeaders(limited) },
    );
  }
  const rlHeaders = ipRateLimitHeaders(limited);
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: rlHeaders });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400, headers: rlHeaders },
    );
  }
  const { wallet, name, url, signature } = parsed.data;
  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400, headers: rlHeaders });
  }
  if (url && !/^https:\/\//.test(url)) {
    return NextResponse.json({ error: "url_must_be_https" }, { status: 400, headers: rlHeaders });
  }

  // Per-wallet write throttle (item 1): a valid signature proves control, but
  // wallets are free to mint, so IP alone is not the whole barrier. Cap how
  // often ONE wallet may (re)register its public payee profile. Keyed on the
  // lowercased address; runs after schema validation so we never spend a
  // wallet-bucket slot on malformed input.
  const walletLimited = await consumeIpRateLimit(
    `payee-verify-wallet:${wallet.toLowerCase()}`,
    POST_WALLET_LIMIT,
    RL_WINDOW_MS,
  );
  if (!walletLimited.allowed) {
    return NextResponse.json(
      { error: "rate_limited", scope: "wallet" },
      { status: 429, headers: ipRateLimitHeaders(walletLimited) },
    );
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: wallet as `0x${string}`,
      message: payeeMessage(wallet, name),
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    return NextResponse.json(
      { error: "signature_mismatch", expectedMessage: payeeMessage(wallet, name) },
      { status: 400 },
    );
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  try {
    await db
      .insert(verifiedPayees)
      .values({ wallet: wallet.toLowerCase(), name, url: url ?? null, signature })
      .onConflictDoUpdate({
        target: verifiedPayees.wallet,
        set: { name, url: url ?? null, signature, verifiedAt: new Date() },
      });
    return NextResponse.json({
      ok: true,
      profile: `/payee/${wallet.toLowerCase()}`,
      badge: `/api/badge/${wallet.toLowerCase()}`,
    });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
    }
    logServerError("payee_verify", error);
    return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  }
}
