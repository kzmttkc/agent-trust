import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { secureCompare } from "@/lib/util/secure-compare";
import { consumeIpRateLimit, getClientIp } from "@/lib/api/ip-rate-limit";
import { getDb } from "@/lib/db/client";

/**
 * ONE-TIME migration runner for health_snapshots (B5, 2026-08-15).
 *
 * Not a general SQL executor — the statement is hardcoded, not accepted from
 * the request, so this cannot become an injection surface. Exists only
 * because this machine cannot read the real production DATABASE_URL (Vercel
 * marks it Sensitive; `vercel env pull` returns it masked — same reason
 * gate2/route.ts computes its report inside the running function instead of
 * locally). Delete this route once scripts/sql/2026-08-15-health-snapshots.sql
 * has been confirmed applied.
 */
function authorizeAdmin(request: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return secureCompare(auth.slice("Bearer ".length).trim(), secret);
}

export async function POST(request: NextRequest) {
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

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  }

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS health_snapshots (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        checked_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS health_snapshots_checked_at_idx
        ON health_snapshots (checked_at)
    `);
    const [{ current_database: currentDatabase }] = (await db.execute(
      sql`SELECT current_database()`,
    )) as unknown as { current_database: string }[];
    return NextResponse.json({ ok: true, database: currentDatabase });
  } catch (error) {
    return NextResponse.json(
      { error: "migration_failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
