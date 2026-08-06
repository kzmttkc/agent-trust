"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { consumeIpRateLimit, getClientIp } from "@/lib/api/ip-rate-limit";
import { authenticateDashboardLogin } from "@/lib/dashboard/auth";
import { ensureOwnerUserId } from "@/lib/db/api-keys";
import { createDashboardSession, dashboardCookieOptions } from "@/lib/dashboard/session";

// 2026-08-06 (UX audit item 7 — progressive enhancement, no-JS fallback).
// The login page keeps its fetch()-based submit for the JavaScript path (it
// shows inline errors and fires retention analytics). This Server Action is
// the SAME form's `action`, so with JavaScript disabled the browser POSTs to
// it natively — the API key travels in the request body (never a URL, the
// whole reason a naive form fix was avoided before) and, on success, the user
// is redirected into the dashboard already carrying the session cookie.
// Outcomes are expressed as redirects because there is no useActionState on
// this form; the JS path owns the rich error UX. `?error=` carries only a
// fixed code, never the key.
export async function loginAction(formData: FormData): Promise<void> {
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) redirect("/dashboard/login?error=invalid_request");

  const requestHeaders = await headers();
  const ip = getClientIp(new Request("http://internal", { headers: requestHeaders }));
  const limited = await consumeIpRateLimit(`dash_login:${ip}`, 20, 60_000);
  if (!limited.allowed) redirect("/dashboard/login?error=rate_limit_exceeded");

  const auth = await authenticateDashboardLogin(apiKey);
  if (!auth) redirect("/dashboard/login?error=invalid_api_key");

  await ensureOwnerUserId(auth.apiKeyId);
  const token = await createDashboardSession(auth.apiKeyId);

  const cookieStore = await cookies();
  cookieStore.set(dashboardCookieOptions(token));

  redirect("/dashboard");
}
