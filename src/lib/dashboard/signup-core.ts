import { z } from "zod";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";
import { createAccount, getAccountByEmail } from "@/lib/db/accounts";
import { createApiKey } from "@/lib/db/api-keys";
import { createDashboardSession } from "@/lib/dashboard/session";
import { secureCompare } from "@/lib/util/secure-compare";

// 2026-08-06 (UX audit item 7 — progressive enhancement). Signup now has TWO
// entry points that must behave identically: the JSON API route (used by the
// JS fetch path) and a Server Action (used by the no-JavaScript native form
// POST). To guarantee they cannot drift — same rate limit, same validation,
// same invite gate, same account/key/session creation — the whole core lives
// here and both callers delegate to runSignup(). The only thing each caller
// does itself is set the session cookie (NextResponse vs. next/headers cookies)
// and shape its own response.

export const SIGNUP_LIMIT = 5;
export const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export const signupSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).optional(),
  inviteCode: z.string().max(64).optional(),
});

export function inviteRequired(): boolean {
  return Boolean(process.env.BETA_INVITE_CODE);
}

export function inviteValid(code: string | undefined): boolean {
  const expected = process.env.BETA_INVITE_CODE;
  if (!expected) return true;
  if (!code) return false;
  return secureCompare(code, expected);
}

export type SignupSuccess = {
  ok: true;
  apiKey: string;
  apiKeyId: string;
  plan: string;
  sessionToken: string;
  inviteRequired: boolean;
};

export type SignupFailure = {
  ok: false;
  error: string;
  status: number;
  retryAfter?: number;
};

export async function runSignup(input: unknown, ip: string): Promise<SignupSuccess | SignupFailure> {
  const limited = await consumeIpRateLimit(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!limited.allowed) {
    return { ok: false, error: "rate_limit_exceeded", status: 429, retryAfter: limited.retryAfter };
  }

  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_request", status: 400 };
  }

  if (!inviteValid(parsed.data.inviteCode)) {
    return { ok: false, error: "invalid_invite_code", status: 403 };
  }

  const existing = await getAccountByEmail(parsed.data.email);
  if (existing) {
    return { ok: false, error: "email_already_registered", status: 409 };
  }

  try {
    const account = await createAccount(parsed.data.email);
    const created = await createApiKey({
      userId: account.id,
      plan: "free",
      name: parsed.data.name ?? "Signup key",
    });
    const sessionToken = await createDashboardSession(created.id);
    return {
      ok: true,
      apiKey: created.key,
      apiKeyId: created.id,
      plan: created.plan,
      sessionToken,
      inviteRequired: inviteRequired(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "signup_failed";
    if (message === "DATABASE_URL is not configured") {
      return { ok: false, error: "database_unavailable", status: 503 };
    }
    return { ok: false, error: "signup_failed", status: 500 };
  }
}
