import { secureCompare } from "@/lib/util/secure-compare";
import { ensureProductionConfig } from "@/lib/config/env";

export function authorizeCron(request: Request): boolean {
  ensureProductionConfig();

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice("Bearer ".length).trim();
  return secureCompare(token, secret);
}
