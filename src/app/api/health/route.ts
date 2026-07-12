import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { secureCompare } from "@/lib/util/secure-compare";
import { isDevelopment } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";

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
    service: "agent-trust-api",
    version: "0.1.0",
    chain: "base",
    erc8004: true,
  };

  if (!deep) {
    return NextResponse.json(payload);
  }

  if (!isDevelopment() && !authorizeAdmin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const checks: Record<string, string> = {};

  try {
    const db = getDb();
    if (!db) {
      checks.database = "unconfigured";
    } else {
      await db.execute(sql`SELECT 1`);
      checks.database = "ok";
    }
  } catch {
    checks.database = "error";
    payload.status = "degraded";
  }

  try {
    const { getPublicClient } = await import("@/lib/chain/client");
    const client = getPublicClient();
    await client.getBlockNumber();
    checks.rpc = "ok";
  } catch {
    checks.rpc = "error";
    payload.status = "degraded";
  }

  payload.checks = checks;
  const statusCode = payload.status === "ok" ? 200 : 503;
  return NextResponse.json(payload, { status: statusCode });
}
