/**
 * Client IP for rate limiting.
 *
 * When TRUST_PROXY_HEADERS=true:
 * - Prefer platform-owned `x-vercel-forwarded-for` (Vercel overwrites this).
 * - Generic `x-forwarded-for` / `x-real-ip` are ONLY trusted when
 *   TRUST_GENERIC_FORWARDED_FOR=true (dangerous off a stripping proxy).
 */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") {
    return "unknown";
  }

  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  if (vercelIp) {
    const first = vercelIp.split(",")[0]?.trim();
    if (first) return first;
  }

  if (process.env.TRUST_GENERIC_FORWARDED_FOR === "true") {
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp.trim();

    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length > 0) return parts[0]!;
    }
  }

  return "unknown";
}
