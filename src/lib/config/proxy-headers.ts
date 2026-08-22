// ============================================================
// Which forwarded-IP header this deployment is allowed to believe.
//
// WHY (2026-08-22 audit). `TRUST_PROXY_HEADERS=true` conflated two different
// statements: "there is a proxy in front of me" and "that proxy is Vercel".
// getClientIp read the second out of the first and trusted
// `x-vercel-forwarded-for` unconditionally. On Vercel that is safe — the
// platform overwrites the header on ingress, so a client cannot set it. Off
// Vercel nothing overwrites it, and docker-compose shipped
// TRUST_PROXY_HEADERS=true as the DEFAULT: any self-hoster's rate limits
// (login, signup, admin, and demo/verify's one-live-purchase-per-IP-per-day)
// were bypassable by adding one request header.
//
// So the source is now named, not inferred:
//
//   PROXY_HEADER_SOURCE=vercel   trust `x-vercel-forwarded-for` only
//   PROXY_HEADER_SOURCE=generic  trust `x-real-ip` / `x-forwarded-for` only
//   PROXY_HEADER_SOURCE=none     trust nothing; every caller is "unknown"
//
// MIGRATION (this is why the legacy vars are still read). Production today
// sets only TRUST_PROXY_HEADERS=true, so an unset PROXY_HEADER_SOURCE is
// inferred from the old pair — but the inference now requires positive
// evidence that we are actually on Vercel (`VERCEL=1`, set by the platform in
// build and runtime) before it will hand out the vercel mode. Vercel keeps
// today's exact behaviour; a self-host that never said which proxy it has
// degrades to `none` (a shared bucket) instead of to a bypass, and
// assertProductionConfig tells the operator to say so explicitly.
// ============================================================

export type ProxyHeaderSource = "vercel" | "generic" | "none";

export const PROXY_HEADER_SOURCES: readonly ProxyHeaderSource[] = ["vercel", "generic", "none"];

/** True when the platform itself says this process runs on Vercel. */
export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1";
}

/**
 * The raw value of PROXY_HEADER_SOURCE when it is set to something, valid or
 * not. Kept separate from the resolution so the production guard can tell
 * "typo" apart from "not configured" — a typo must never silently fall back
 * to the legacy inference.
 */
export function rawProxyHeaderSource(): string | null {
  const raw = process.env.PROXY_HEADER_SOURCE?.trim();
  return raw ? raw.toLowerCase() : null;
}

export function isValidProxyHeaderSource(value: string): value is ProxyHeaderSource {
  return (PROXY_HEADER_SOURCES as readonly string[]).includes(value);
}

/**
 * The source actually in effect. An invalid PROXY_HEADER_SOURCE resolves to
 * `none` (fail-closed: an unreadable setting must not be read as permission),
 * and the production guard turns the same condition into a boot error.
 */
export function resolveProxyHeaderSource(): ProxyHeaderSource {
  const explicit = rawProxyHeaderSource();
  if (explicit !== null) {
    return isValidProxyHeaderSource(explicit) ? explicit : "none";
  }

  // ---- legacy inference (TRUST_PROXY_HEADERS / TRUST_GENERIC_FORWARDED_FOR)
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "none";
  // Vercel first: on Vercel the platform-owned header is the better one, and
  // this is the branch today's production takes.
  if (isVercelRuntime()) return "vercel";
  if (process.env.TRUST_GENERIC_FORWARDED_FOR === "true") return "generic";
  // "Behind some proxy" off Vercel is not evidence about WHICH header can be
  // believed. Refusing to guess is what closes the bypass.
  return "none";
}

/** True when the legacy pair is doing the deciding — used to emit the deprecation warning. */
export function isUsingLegacyProxyConfig(): boolean {
  return rawProxyHeaderSource() === null && process.env.TRUST_PROXY_HEADERS === "true";
}
