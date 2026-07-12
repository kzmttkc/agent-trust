import { getAppEnv } from "@/lib/config/env";

export function validateDashboardOrigin(request: Request): boolean {
  if (getAppEnv() === "development") return true;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}
