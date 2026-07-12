import { NextRequest, NextResponse } from "next/server";
import { canManageApiKey, revokeApiKey } from "@/lib/db/api-keys";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { deleteDashboardSessionsForApiKey } from "@/lib/dashboard/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const { id } = await context.params;

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
