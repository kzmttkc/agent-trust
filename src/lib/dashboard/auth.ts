import { NextResponse } from "next/server";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { getApiKeyById } from "@/lib/db/api-keys";
import { validateDashboardOrigin } from "@/lib/dashboard/csrf";
import {
  dashboardCookieOptions,
  getDashboardSessionFromCookies,
} from "@/lib/dashboard/session";

export type DashboardAuthContext = {
  apiKeyId: string;
  plan: string;
};

function rateLimitError(rateLimit: Awaited<ReturnType<typeof consumeRateLimit>>) {
  const headers = rateLimitHeaders(rateLimit);
  if (rateLimit.retryAfter) {
    headers["Retry-After"] = String(rateLimit.retryAfter);
  }

  return NextResponse.json(
    { error: "rate_limit_exceeded", retryAfter: rateLimit.retryAfter },
    { status: 429, headers },
  );
}

async function resolveDashboardKey(): Promise<DashboardAuthContext | null> {
  const session = await getDashboardSessionFromCookies();
  if (!session) return null;

  const key = await getApiKeyById(session.apiKeyId);
  if (!key || key.revokedAt) return null;

  return { apiKeyId: key.id, plan: key.plan };
}

export async function authenticateDashboardRequest(): Promise<
  { ok: true; ctx: DashboardAuthContext } | { ok: false; error: NextResponse }
> {
  const sessionCtx = await resolveDashboardKey();
  if (sessionCtx) {
    return { ok: true, ctx: sessionCtx };
  }

  return {
    ok: false,
    error: NextResponse.json({ error: "session_required" }, { status: 401 }),
  };
}

export async function applyDashboardRateLimit(
  ctx: DashboardAuthContext,
  units: number,
): Promise<{ ok: true } | { ok: false; error: NextResponse }> {
  if (units <= 0) return { ok: true };

  const rateLimit = await consumeRateLimit(ctx.apiKeyId, ctx.plan, units);
  if (!rateLimit.allowed) {
    return { ok: false, error: rateLimitError(rateLimit) };
  }

  return { ok: true };
}

function validateMutationOrigin(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return null;
  if (!validateDashboardOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  return null;
}

export async function authorizeDashboardRequest(
  request: Request,
  units = 0,
): Promise<
  | { ok: true; ctx: DashboardAuthContext }
  | { ok: false; error: NextResponse }
> {
  const originError = validateMutationOrigin(request);
  if (originError) {
    return { ok: false, error: originError };
  }

  const auth = await authenticateDashboardRequest();
  if (!auth.ok) return auth;

  if (units > 0) {
    const limited = await applyDashboardRateLimit(auth.ctx, units);
    if (!limited.ok) return limited;
  }

  return auth;
}

export async function authenticateDashboardLogin(
  apiKey: string,
): Promise<DashboardAuthContext | null> {
  // 2026-08-15 認証監査: この関数は受け取った文字列をそのまま Authorization
  // ヘッダに載せて既存の API 認証へ委譲する。undici の Headers は制御文字
  // (CR/LF/NUL/DEL 等) を含む値を TypeError で拒否するため、キー欄に改行を1つ
  // 入れるだけで、ログインが 401 ではなく未捕捉例外 → 500 になっていた
  // （/api/dashboard/session と no-JS の Server Action の両方）。
  // 認証の突破ではないが、未認証の第三者が任意にサーバ例外を起こせる。
  // ヘッダ値として表現できない文字列は Bearer トークンとして送れない＝実在する
  // APIキーではありえないので、ここで「存在しない鍵」として 401 に閉じる。
  // 判定そのもの（verifyApiKey）は一切変えない。
  let fakeRequest: Request;
  try {
    fakeRequest = new Request("http://localhost", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return null;
  }
  const { authenticateRequest } = await import("@/lib/api/auth");
  const auth = await authenticateRequest(fakeRequest);
  if (!auth.ok || auth.apiKeyId === "dev" || !auth.apiKeyId || !auth.plan) {
    return null;
  }
  return { apiKeyId: auth.apiKeyId, plan: auth.plan };
}

export function setDashboardSessionCookie(response: NextResponse, token: string) {
  const options = dashboardCookieOptions(token);
  response.cookies.set(options);
  return response;
}

export function clearDashboardSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: dashboardCookieOptions("").name,
    value: "",
    httpOnly: true,
    secure: dashboardCookieOptions("").secure,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
