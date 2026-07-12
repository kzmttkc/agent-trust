import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { isProduction, secureCookiesEnabled } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { dashboardSessions } from "@/lib/db/schema";

export const DASHBOARD_COOKIE = "vouch_dash";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sessionSecret(): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (secret) return secret;
  if (isProduction()) {
    throw new Error("DASHBOARD_SESSION_SECRET is required in production");
  }
  return "dev_dashboard_secret_change_me";
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(`${sessionSecret()}:${token}`).digest("hex");
}

export async function createDashboardSession(apiKeyId: string): Promise<string> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  await db.delete(dashboardSessions).where(eq(dashboardSessions.apiKeyId, apiKeyId));

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(dashboardSessions).values({
    tokenHash: hashSessionToken(token),
    apiKeyId,
    expiresAt,
  });

  return token;
}

export async function resolveDashboardSession(
  token: string | undefined,
): Promise<{ apiKeyId: string } | null> {
  if (!token) return null;

  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select({ apiKeyId: dashboardSessions.apiKeyId })
    .from(dashboardSessions)
    .where(
      and(
        eq(dashboardSessions.tokenHash, hashSessionToken(token)),
        gt(dashboardSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return rows[0] ? { apiKeyId: rows[0].apiKeyId } : null;
}

export async function deleteDashboardSession(token: string | undefined): Promise<void> {
  if (!token) return;

  const db = getDb();
  if (!db) return;

  await db
    .delete(dashboardSessions)
    .where(eq(dashboardSessions.tokenHash, hashSessionToken(token)));
}

export async function deleteDashboardSessionsForApiKey(apiKeyId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.delete(dashboardSessions).where(eq(dashboardSessions.apiKeyId, apiKeyId));
}

export async function getDashboardSessionFromCookies(): Promise<{ apiKeyId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_COOKIE)?.value;
  return resolveDashboardSession(token);
}

export function dashboardCookieOptions(token: string) {
  return {
    name: DASHBOARD_COOKIE,
    value: token,
    httpOnly: true,
    secure: secureCookiesEnabled(),
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
