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

  // 2026-08-06 security (self-audit item 4): the unauthenticated liveness
  // probe now returns ONLY {status:"ok"}. It previously leaked version
  // (0.1.0), chain, and the erc8004 flag — fingerprinting material, and a
  // "0.1.0" visible to a prospect reads as pre-production. A liveness check
  // needs to answer exactly one question: is the service up. Detailed service
  // metadata moved behind the same admin gate as the deep checks below.
  if (!deep) {
    return NextResponse.json({ status: "ok" });
  }

  // Always require admin for deep health — never gate on APP_ENV alone.
  if (!authorizeAdmin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Authenticated callers get the full picture, including the service
  // metadata that used to be public.
  const payload: Record<string, unknown> = {
    status: "ok",
    service: "vouch-trust-api",
    version: "0.1.0",
    chain: "base",
    erc8004: true,
  };

  const deepResult = await runDeepHealthChecks();
  payload.status = deepResult.status;
  payload.checks = deepResult.checks;
  if (deepResult.env) payload.env = deepResult.env;
  if (deepResult.indexer) payload.indexer = deepResult.indexer;

  const statusCode = deepResult.criticalFailure ? 503 : 200;
  return NextResponse.json(payload, { status: statusCode });
}
