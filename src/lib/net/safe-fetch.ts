// ============================================================
// safeFetch — an SSRF-guarded `fetch` for URLs we did not choose.
//
// WHY (2026-08-15 security audit). The observatory's target list is the public
// CDP Bazaar catalog: `resource` is a string a third party self-declared, and
// vet402 copies it into x402_endpoints.resource_url and then requests it from
// inside its own serverless function — twice, in fact (L0 probe, L1 paid
// purchase), both with `redirect: "follow"`. Nothing checked where that URL
// pointed. A listed resource of `http://169.254.169.254/latest/meta-data/…`,
// `http://127.0.0.1:3000/api/admin/gate2`, or a bare internal name would have
// been fetched on schedule by our cron, with the first 500 bytes of the reply
// written to x402_l0_probes.raw_response_meta. Measured the same day: 1,400
// sampled catalog rows were all https with public hostnames — so this is a
// gate on an unlocked door, not a fire being put out.
//
// WHAT IT GUARANTEES: no request is issued to a URL whose scheme is not
// http(s), or whose host is (or resolves to) a non-public-unicast address —
// on the first hop OR on any redirect hop, because a first-hop-only check that
// then follows redirects is theater.
//
// WHAT IT DOES NOT: it does not pin the socket to the verified IP, so a DNS
// record that flips between our lookup and undici's leaves a rebinding window.
// Closing it requires driving node:https directly and giving up the Response
// API these callers are built on (webhooks.ts does exactly that, because there
// the URL is chosen by an authenticated customer and delivery carries a
// signature). Stated here rather than implied, so nobody re-derives the
// guarantee from the name.
// ============================================================
import {
  defaultResolver,
  isPublicUnicastIp,
  type AddressResolver,
} from "./public-address";

export type UnsafeTargetReason =
  | "unsafe_scheme"
  | "unsafe_host"
  | "unresolvable"
  | "too_many_redirects";

export class UnsafeTargetError extends Error {
  readonly reason: UnsafeTargetReason;
  readonly target: string;

  constructor(reason: UnsafeTargetReason, target: string) {
    super(`unsafe outbound target (${reason}): ${target}`);
    this.name = "UnsafeTargetError";
    this.reason = reason;
    this.target = target;
  }
}

/** Hostnames that are internal by name rather than by address. */
function isInternalName(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  );
}

/**
 * String-level gate: everything decidable without touching DNS. Public API so
 * callers can reject a stored URL cheaply (and so the rules are testable
 * without a resolver).
 */
export function isPublicHostUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (isInternalName(host)) return false;

  // IPv6 literal — URL.hostname keeps the brackets.
  if (host.startsWith("[")) {
    return isPublicUnicastIp(host.slice(1, -1));
  }
  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isPublicUnicastIp(host);
  }
  // A single-label name (no dot) is an intranet name by construction.
  if (!host.includes(".")) return false;
  return true;
}

function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Throws UnsafeTargetError unless `url` is safe to open a socket to. */
async function assertPublicTarget(url: URL, resolve: AddressResolver): Promise<void> {
  const href = url.toString();
  if (!isPublicHostUrl(href)) {
    throw new UnsafeTargetError(
      url.protocol !== "https:" && url.protocol !== "http:" ? "unsafe_scheme" : "unsafe_host",
      href,
    );
  }
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) return; // already judged as a literal, nothing to resolve

  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolve(host);
  } catch {
    throw new UnsafeTargetError("unresolvable", href);
  }
  if (!addrs || addrs.length === 0) throw new UnsafeTargetError("unresolvable", href);
  for (const a of addrs) {
    // ANY non-public answer rejects the name: a split record where one A is
    // public and the next is 127.0.0.1 must not be decided by ordering.
    if (!isPublicUnicastIp(a.address)) throw new UnsafeTargetError("unsafe_host", href);
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type SafeFetchOptions = {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  resolve?: AddressResolver;
  /** Hops followed after the initial request. */
  maxRedirects?: number;
};

/**
 * `fetch`, except every hop's target must be a public address. Redirects are
 * followed manually (`redirect: "manual"`) so each `Location` passes the same
 * gate as the URL the caller handed us — with the platform's own follow logic
 * we would only ever see the first hop.
 *
 * Method/body handling mirrors the fetch spec (and undici): 303 always demotes
 * to GET; 301/302 demote a POST to GET; 307/308 preserve both. The body is
 * dropped along with the method, and with it Content-Type.
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { fetchImpl = fetch, resolve = defaultResolver, maxRedirects = 5 } = options;

  let current: URL;
  try {
    current = new URL(input);
  } catch {
    throw new UnsafeTargetError("unsafe_scheme", input);
  }

  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers = new Headers(init.headers);

  for (let hop = 0; ; hop++) {
    await assertPublicTarget(current, resolve);

    const response = await fetchImpl(current.toString(), {
      ...init,
      method,
      body,
      headers,
      redirect: "manual",
    });

    const location = REDIRECT_STATUS.has(response.status)
      ? response.headers.get("location")
      : null;
    if (!location) return response;

    if (hop >= maxRedirects) {
      throw new UnsafeTargetError("too_many_redirects", current.toString());
    }

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return response; // unparseable Location: hand the 3xx back, don't guess
    }

    const demote =
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== "GET" &&
        method !== "HEAD");
    if (demote) {
      method = "GET";
      body = undefined;
      headers = new Headers(headers);
      headers.delete("content-type");
      headers.delete("content-length");
    }
    current = next;
  }
}

/**
 * The drop-in `fetchImpl` shape the observatory modules take. Their injection
 * point already has the (url, init) signature, so the guard installs as the
 * production default without touching a call site.
 */
export function createSafeFetchImpl(
  options: SafeFetchOptions = {},
): (url: string, init?: RequestInit) => Promise<Response> {
  return (url, init) => safeFetch(url, init ?? {}, options);
}
