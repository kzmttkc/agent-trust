import { NextRequest, NextResponse } from "next/server";
import { secureCompare } from "@/lib/util/secure-compare";
import { runDeepHealthChecks } from "@/lib/health/deep-checks";

function authorizeAdmin(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice("Bearer ".length).trim();
  return secureCompare(token, secret);
}

export async function GET(request: NextRequest) {
  const deep = request.nextUrl.searchParams.get("deep") === "1";
  const payload: Record<string, unknown> = {
    status: "ok",
    service: "vouch-trust-api",
    version: "0.1.0",
    chain: "base",
    erc8004: true,
  };

  if (!deep) {
    return NextResponse.json(payload);
  }

  // Always require admin for deep health — never gate on APP_ENV alone.
  if (!authorizeAdmin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deepResult = await runDeepHealthChecks();
  payload.status = deepResult.status;
  payload.checks = deepResult.checks;
  if (deepResult.env) payload.env = deepResult.env;
  if (deepResult.indexer) payload.indexer = deepResult.indexer;

  const statusCode = deepResult.criticalFailure ? 503 : 200;
  return NextResponse.json(payload, { status: statusCode });
}
