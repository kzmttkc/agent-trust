import { NextResponse } from "next/server";
import { authenticateRequest } from "./auth";
import {
  consumeRateLimit,
  rateLimitHeaders,
  type RateLimitResult,
} from "./rate-limit";

export type AuthorizedContext = {
  apiKeyId: string;
  plan: string;
  rateLimit: RateLimitResult;
};

export type AuthenticatedContext = {
  apiKeyId: string;
  plan: string;
};

export async function authenticateApiRequest(
  request: Request,
): Promise<{ ok: true; ctx: AuthenticatedContext } | { ok: false; error: NextResponse }> {
  const auth = await authenticateRequest(request);
  if (!auth.ok) {
    return { ok: false, error: auth.error! };
  }

  return {
    ok: true,
    ctx: { apiKeyId: auth.apiKeyId!, plan: auth.plan! },
  };
}

export async function applyRateLimit(
  ctx: AuthenticatedContext,
  units = 1,
): Promise<{ ok: true; rateLimit: RateLimitResult } | { ok: false; error: NextResponse }> {
  const rateLimit = await consumeRateLimit(ctx.apiKeyId, ctx.plan, units);
  if (!rateLimit.allowed) {
    const headers = rateLimitHeaders(rateLimit);
    if (rateLimit.retryAfter) {
      headers["Retry-After"] = String(rateLimit.retryAfter);
    }

    return {
      ok: false,
      error: NextResponse.json(
        {
          error: "rate_limit_exceeded",
          retryAfter: rateLimit.retryAfter,
          usage: rateLimit.usage,
          limit: rateLimit.limit,
        },
        { status: 429, headers },
      ),
    };
  }

  return { ok: true, rateLimit };
}

export async function authorizeApiRequest(
  request: Request,
  units = 1,
): Promise<{ ok: true; ctx: AuthorizedContext } | { ok: false; error: NextResponse }> {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth;

  const limited = await applyRateLimit(auth.ctx, units);
  if (!limited.ok) return limited;

  return {
    ok: true,
    ctx: {
      apiKeyId: auth.ctx.apiKeyId,
      plan: auth.ctx.plan,
      rateLimit: limited.rateLimit,
    },
  };
}

export function withRateLimitHeaders(
  response: NextResponse,
  rateLimit: RateLimitResult,
): NextResponse {
  for (const [key, value] of Object.entries(rateLimitHeaders(rateLimit))) {
    response.headers.set(key, value);
  }
  return response;
}
