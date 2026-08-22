import { resolveProxyHeaderSource } from "@/lib/config/proxy-headers";

/**
 * Client IP for rate limiting.
 *
 * Which header may be believed is decided by PROXY_HEADER_SOURCE — see
 * src/lib/config/proxy-headers.ts for the modes and the migration path from
 * the older TRUST_PROXY_HEADERS / TRUST_GENERIC_FORWARDED_FOR pair.
 *
 *   vercel  → `x-vercel-forwarded-for` only (the platform overwrites it, so a
 *             client cannot set it; this is what production runs)
 *   generic → `x-real-ip` / `x-forwarded-for` only, and ONLY sound behind a
 *             proxy that rewrites them
 *   none    → "unknown" for everyone: one shared bucket, which throttles the
 *             deployment rather than handing out a per-request bypass
 *
 * 2026-08-22: the old code trusted `x-vercel-forwarded-for` whenever
 * TRUST_PROXY_HEADERS=true, including on self-hosted deployments where
 * nothing overwrites it — one header made every per-IP limit unenforceable.
 */
export function getClientIp(request: Request): string {
  const source = resolveProxyHeaderSource();
  if (source === "none") return "unknown";

  if (source === "vercel") {
    const vercelIp = request.headers.get("x-vercel-forwarded-for");
    if (vercelIp) {
      const first = vercelIp.split(",")[0]?.trim();
      if (first) return first;
    }
    return "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) return parts[0]!;
  }

  return "unknown";
}
