import { NextRequest, NextResponse } from "next/server";
import { assertProductionConfig } from "@/lib/config/env";
import { secureCompare } from "@/lib/util/secure-compare";
import { consumeIpRateLimit, getClientIp } from "@/lib/api/ip-rate-limit";
import { z } from "zod";
import { isValidAddress } from "@/lib/chain/client";
import { addCustomerListEntry } from "@/lib/db/customer-lists";
import { invalidateScoreCacheForListChange } from "@/lib/scoring/cache-invalidation";

const bodySchema = z.object({
  wallet: z.string(),
  listType: z.enum(["blacklist"]),
});

function authorizeAdmin(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice("Bearer ".length).trim();
  return secureCompare(token, secret);
}

export async function POST(request: NextRequest) {
  assertProductionConfig();

  const ip = getClientIp(request);
  const limited = await consumeIpRateLimit(`admin:${ip}`, 30, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", retryAfter: limited.retryAfter },
      { status: 429 },
    );
  }

  if (!authorizeAdmin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success || !isValidAddress(parsed.data.wallet)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const entry = await addCustomerListEntry({
    apiKeyId: null,
    wallet: parsed.data.wallet,
    listType: "blacklist",
    global: true,
  });

  await invalidateScoreCacheForListChange(parsed.data.wallet);

  return NextResponse.json({ entry }, { status: 201 });
}
