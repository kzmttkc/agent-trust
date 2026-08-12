import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/auth";
import { isValidAddress } from "@/lib/chain/client";
import { scoreWallet } from "@/lib/scoring/engine";

// TEMP diagnostic (2026-08-13) — read-only, no DB writes. scoreWallet itself
// never inserts; only the benchmark runner's scoreAndRecord does. Deployed
// only to see why known-good benchmark addresses score as low as known-bad
// ones (/accuracy: 17/17 false-positive on known-good). Delete after use.
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const address = request.nextUrl.searchParams.get("address");
  if (!address || !isValidAddress(address)) {
    return NextResponse.json({ error: "invalid_address" }, { status: 400 });
  }
  const result = await scoreWallet(address, {});
  return NextResponse.json(result);
}
