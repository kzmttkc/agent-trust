import { NextRequest, NextResponse } from "next/server";
import { canManageApiKey, revokeApiKey } from "@/lib/db/api-keys";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { deleteDashboardSessionsForApiKey } from "@/lib/dashboard/session";
import { UUID_RE } from "@/lib/validation/uuid";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const { id } = await context.params;

  // 2026-08-22 audit: the path id went straight into a `::uuid` comparison, so
  // a malformed one raised Postgres 22P02 and the route answered 500 for what
  // is plainly "no such key". Answering 404 — the same shape a well-formed id
  // that does not exist gets — keeps the two indistinguishable to a caller.
  // The authorization itself (canManageApiKey, owner-scoped) is untouched.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "api_key_not_found" }, { status: 404 });
  }

  if (id === auth.ctx.apiKeyId) {
    return NextResponse.json({ error: "cannot_revoke_active_session_key" }, { status: 400 });
  }

  const allowed = await canManageApiKey(auth.ctx.apiKeyId, id);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const revoked = await revokeApiKey(id);
  if (!revoked) {
    return NextResponse.json({ error: "api_key_not_found" }, { status: 404 });
  }

  await deleteDashboardSessionsForApiKey(id);

  return NextResponse.json({ ok: true });
}
