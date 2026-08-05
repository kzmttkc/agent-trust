import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyMessage } from "viem";
import { getClientIp } from "@/lib/api/client-ip";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";
import { getDb } from "@/lib/db/client";
import { isMissingSchemaError } from "@/lib/db/pg-errors";
import { verifiedPayees } from "@/lib/db/schema";
import { isValidAddress } from "@/lib/chain/client";
import { logServerError } from "@/lib/util/log";

// N-16 — payee self-verification. Sign the canonical message with the payee
// wallet; a valid signature IS the proof of control (EIP-191 via viem, which
// also handles smart accounts per EIP-6492 where supported). No API key
// required: registering yourself as a payee should have zero friction, and
// the signature requirement is the anti-abuse gate.
export function payeeMessage(wallet: string, name: string): string {
  return [
    "Vouch verified payee registration",
    `wallet: ${wallet.toLowerCase()}`,
    `name: ${name}`,
    "This signature only proves control of the wallet above.",
  ].join("\n");
}

const schema = z.object({
  wallet: z.string(),
  name: z.string().min(1).max(80),
  url: z.string().url().max(200).optional(),
  signature: z.string().max(4000),
});

// Preview the exact canonical message for a given (wallet, name) pair, so a
// caller can construct + sign it before ever attempting POST. Read-only, no
// rate limit needed — it echoes input, touches no store.
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet") ?? "";
  const name = request.nextUrl.searchParams.get("name") ?? "";
  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json({ message: payeeMessage(wallet, name) });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request) ?? "unknown";
  const limited = await consumeIpRateLimit(`payee-verify:${ip}`, 10, 60_000);
  if (!limited.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { wallet, name, url, signature } = parsed.data;
  if (!isValidAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet_address" }, { status: 400 });
  }
  if (url && !/^https:\/\//.test(url)) {
    return NextResponse.json({ error: "url_must_be_https" }, { status: 400 });
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
