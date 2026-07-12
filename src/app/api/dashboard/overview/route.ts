import { NextRequest, NextResponse } from "next/server";
import { authorizeDashboardRequest } from "@/lib/dashboard/auth";
import { getDashboardOverview } from "@/lib/dashboard/data";

export async function GET(request: NextRequest) {
  const auth = await authorizeDashboardRequest(request);
  if (!auth.ok) return auth.error;

  try {
    const overview = await getDashboardOverview(auth.ctx.apiKeyId);
    return NextResponse.json(overview);
  } catch {
    return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  }
}
