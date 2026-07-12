import { NextRequest, NextResponse } from "next/server";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { getTrustEventLogs } from "@/lib/dashboard/data";

export async function GET(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : 50;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(100, Math.max(1, parsedLimit))
    : 50;

  const logs = await getTrustEventLogs(auth.ctx.apiKeyId, limit);

  return NextResponse.json({
    logs: logs.map((log) => ({
      ...log,
      agentId: log.agentId?.toString() ?? null,
    })),
  });
}
