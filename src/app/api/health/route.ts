import { NextRequest, NextResponse } from "next/server";
import { secureCompare } from "@/lib/util/secure-compare";
import { runDeepHealthChecks } from "@/lib/health/deep-checks";
import { runScoringProbe } from "@/lib/health/scoring-probe";

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
  // probe returns ONLY a status. It previously leaked version (0.1.0), chain,
  // and the erc8004 flag — fingerprinting material, and a "0.1.0" visible to a
  // prospect reads as pre-production. Detailed service metadata stays behind
  // the admin gate below.
  //
  // 2026-08-12: that status used to be the STRING LITERAL "ok" — it could not
  // report anything else, because it checked nothing. It answered 200/ok
  // throughout a total scoring outage, while the docs were telling customers
  // to point their uptime monitor here. A monitor that is green while the
  // product is down is worse than no monitor: it converts an outage into a
  // silent one. The status now comes from an actual probe of the scoring path.
  //
  // Still exactly one bit of information to an anonymous caller — up or not —
  // so nothing new is leaked. Which upstream is unhappy stays admin-only.
  if (!deep) {
    const scoring = await runScoringProbe();
    if (scoring.status === "error") {
      return NextResponse.json({ status: "error" }, { status: 503 });
    }
    return NextResponse.json({ status: scoring.status === "degraded" ? "degraded" : "ok" });
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
