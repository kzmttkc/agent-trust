import { NextRequest, NextResponse } from "next/server";
import { secureCompare } from "@/lib/util/secure-compare";
import { buildGate2Report, Gate2NotConfiguredError, Gate2SchemaMissingError } from "@/lib/gate2/report";

/**
 * Admin-only Gate2 PMF report, computed inside the running production
 * function where process.env.DATABASE_URL is populated by Vercel at
 * runtime — even though the value is a "Sensitive" env var and therefore
 * unreadable via `vercel env pull` / dashboard / API on this machine.
 * See src/lib/gate2/report.ts for the full rationale.
 *
 * Added 2026-07-26 to unblock weekly Gate2 measurement (state/gate2-ledger.json
 * had been empty since inception because the CLI script requires a local
 * DATABASE_URL that cannot be retrieved).
 */
function authorizeAdmin(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice("Bearer ".length).trim();
  return secureCompare(token, secret);
}

export async function GET(request: NextRequest) {
  if (!authorizeAdmin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const report = await buildGate2Report();
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof Gate2NotConfiguredError) {
      return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
    }
    if (error instanceof Gate2SchemaMissingError) {
      return NextResponse.json({ error: "schema_not_ready" }, { status: 503 });
    }
    console.error("gate2 admin route: unexpected error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
