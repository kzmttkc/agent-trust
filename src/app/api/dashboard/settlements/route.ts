import { NextRequest, NextResponse } from "next/server";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { listX402PaymentsForApiKey } from "@/lib/db/x402-payments";

export async function GET(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : 50;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 50;

  try {
    const settlements = await listX402PaymentsForApiKey(auth.ctx.apiKeyId, limit);
    return NextResponse.json({
      settlements: settlements.map((row) => ({
        id: row.id,
        wallet: row.wallet,
        amount: row.amount,
        txHash: row.txHash,
        network: row.network,
        resource: row.resource,
        createdAt: row.createdAt?.toISOString() ?? null,
      })),
    });
  } catch {
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}
