import { NextRequest, NextResponse } from "next/server";
import { removeCustomerListEntry } from "@/lib/db/customer-lists";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { invalidateScoreCacheForListChange } from "@/lib/scoring/cache-invalidation";
import { UUID_RE } from "@/lib/validation/uuid";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const { id } = await context.params;

  // 2026-08-22 audit: same 22P02 → 500 as dashboard/keys/[id]. A malformed id
  // is "no such entry", not a server fault. The owner-scoped removal
  // (removeCustomerListEntry binds apiKeyId) is unchanged.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "entry_not_found" }, { status: 404 });
  }

  const result = await removeCustomerListEntry(auth.ctx.apiKeyId, id);
  if (!result.removed) {
    return NextResponse.json({ error: "entry_not_found" }, { status: 404 });
  }

  if (result.wallet) {
    await invalidateScoreCacheForListChange(result.wallet);
  }

  return NextResponse.json({ ok: true });
}
