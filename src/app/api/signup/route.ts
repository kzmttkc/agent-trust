import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeIpRateLimit, getClientIp } from "@/lib/api/ip-rate-limit";
import { createAccount, getAccountByEmail } from "@/lib/db/accounts";
import { createApiKey } from "@/lib/db/api-keys";
import { validateDashboardOrigin } from "@/lib/dashboard/csrf";
import { setDashboardSessionCookie } from "@/lib/dashboard/auth";
import { createDashboardSession } from "@/lib/dashboard/session";
import { secureCompare } from "@/lib/util/secure-compare";

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

const signupSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).optional(),
  inviteCode: z.string().max(64).optional(),
});

function inviteRequired(): boolean {
  return Boolean(process.env.BETA_INVITE_CODE);
}

function inviteValid(code: string | undefined): boolean {
  const expected = process.env.BETA_INVITE_CODE;
  if (!expected) return true;
  if (!code) return false;
  return secureCompare(code, expected);
}

export async function POST(request: NextRequest) {
  if (!validateDashboardOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const limited = await consumeIpRateLimit(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", retryAfter: limited.retryAfter },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!inviteValid(parsed.data.inviteCode)) {
    return NextResponse.json({ error: "invalid_invite_code" }, { status: 403 });
  }

  const existing = await getAccountByEmail(parsed.data.email);
  if (existing) {
    return NextResponse.json({ error: "email_already_registered" }, { status: 409 });
  }

  try {
    const account = await createAccount(parsed.data.email);
    const created = await createApiKey({
      userId: account.id,
      plan: "free",
      name: parsed.data.name ?? "Signup key",
    });

    const sessionToken = await createDashboardSession(created.id);
    const response = NextResponse.json(
      {
        ok: true,
        apiKey: created.key,
        apiKeyId: created.id,
        plan: created.plan,
        inviteRequired: inviteRequired(),
      },
      { status: 201 },
    );

    return setDashboardSessionCookie(response, sessionToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "signup_failed";
    if (message === "DATABASE_URL is not configured") {
      return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "signup_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    inviteRequired: inviteRequired(),
    plans: ["free", "pro", "scale"],
  });
}
