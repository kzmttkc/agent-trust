import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeIpRateLimit, getClientIp } from "@/lib/api/ip-rate-limit";
import {
  authenticateDashboardLogin,
  clearDashboardSessionCookie,
  setDashboardSessionCookie,
} from "@/lib/dashboard/auth";
import { validateDashboardOrigin } from "@/lib/dashboard/csrf";
import { ensureOwnerUserId } from "@/lib/db/api-keys";
import { createDashboardSession, deleteDashboardSession } from "@/lib/dashboard/session";
import { cookies } from "next/headers";
import { DASHBOARD_COOKIE } from "@/lib/dashboard/session";

const loginSchema = z.object({
  apiKey: z.string().min(1),
});

export async function POST(request: NextRequest) {
  if (!validateDashboardOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const limited = await consumeIpRateLimit(`dash_login:${ip}`, 20, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", retryAfter: limited.retryAfter },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const auth = await authenticateDashboardLogin(parsed.data.apiKey.trim());
  if (!auth) {
    return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  }

  await ensureOwnerUserId(auth.apiKeyId);
  const token = await createDashboardSession(auth.apiKeyId);
  const response = NextResponse.json({ ok: true });
  return setDashboardSessionCookie(response, token);
}

export async function DELETE(request: NextRequest) {
  if (!validateDashboardOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(DASHBOARD_COOKIE)?.value;
  await deleteDashboardSession(token);

  const response = NextResponse.json({ ok: true });
  return clearDashboardSessionCookie(response);
}
