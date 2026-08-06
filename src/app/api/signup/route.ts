import { NextRequest, NextResponse } from "next/server";
import { validateDashboardOrigin } from "@/lib/dashboard/csrf";
import { setDashboardSessionCookie } from "@/lib/dashboard/auth";
import { getClientIp } from "@/lib/api/ip-rate-limit";
import { inviteRequired, runSignup } from "@/lib/dashboard/signup-core";

// JSON signup endpoint for the JS fetch path. The core (rate limit, schema,
// invite gate, account/key/session creation) lives in signup-core.ts and is
// shared verbatim with the no-JS Server Action (src/app/signup/actions.ts) so
// the two paths cannot diverge — see that file for the progressive-enhancement
// rationale (2026-08-06 UX audit item 7).
export async function POST(request: NextRequest) {
  if (!validateDashboardOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const body = await request.json().catch(() => null);
  const result = await runSignup(body, ip);

  if (!result.ok) {
    const payload: Record<string, unknown> = { error: result.error };
    if (result.retryAfter !== undefined) payload.retryAfter = result.retryAfter;
    return NextResponse.json(payload, { status: result.status });
  }

  const response = NextResponse.json(
    {
      ok: true,
      apiKey: result.apiKey,
      apiKeyId: result.apiKeyId,
      plan: result.plan,
      inviteRequired: result.inviteRequired,
    },
    { status: 201 },
  );
  return setDashboardSessionCookie(response, result.sessionToken);
}

export async function GET() {
  return NextResponse.json({
    inviteRequired: inviteRequired(),
    plans: ["free", "pro", "scale"],
  });
}
