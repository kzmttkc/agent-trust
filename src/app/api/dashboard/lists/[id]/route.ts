import { NextRequest, NextResponse } from "next/server";
import { removeCustomerListEntry } from "@/lib/db/customer-lists";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { invalidateScoreCacheForListChange } from "@/lib/scoring/cache-invalidation";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const { id } = await context.params;
  const result = await removeCustomerListEntry(auth.ctx.apiKeyId, id);
  if (!result.removed) {
    return NextResponse.json({ error: "entry_not_found" }, { status: 404 });
  }

  if (result.wallet) {
    await invalidateScoreCacheForListChange(result.wallet);
  }

  return NextResponse.json({ ok: true });
}
