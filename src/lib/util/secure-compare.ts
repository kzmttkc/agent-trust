import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string compare (length-independent via SHA-256).
 * Avoids secret-length timing oracles from early length mismatch returns.
 */
export function secureCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}
