// ============================================================
// Outbound-address classification — the shared half of the SSRF defense.
//
// Extracted verbatim (2026-08-15 security audit) from src/lib/webhooks.ts,
// which had the only correct copy in the codebase. It now has two callers:
//
//   - webhook delivery (customer-registered URL, HTTPS, socket pinned to the
//     verified IP — see webhooks.ts),
//   - the observatory's L0 prober / L1 purchaser, whose target URLs come from
//     the public Bazaar catalog and are therefore third-party input we never
//     chose (see src/lib/net/safe-fetch.ts).
//
// One copy, one set of tests: a predicate this load-bearing must not be
// re-derived per caller.
// ============================================================
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * True only for addresses that are safe to egress to: globally-routable
 * unicast IPv4/IPv6. Everything private, reserved, loopback, link-local,
 * CGNAT, ULA, multicast, or unspecified is rejected. IPv4-mapped/embedded
 * IPv6 forms are unwrapped and judged as the IPv4 they target.
 */
export function isPublicUnicastIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPublicIPv4(ip);
  if (!net.isIPv6(ip)) return false;

  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone); // strip scope id (fe80::1%eth0)

  // IPv4-mapped (::ffff:1.2.3.4), IPv4-compatible (::1.2.3.4), or any form
  // carrying a dotted-quad tail: the routable target is that IPv4.
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted) return isPublicIPv4(dotted[1]);

  if (s === "::" || s === "::1") return false; // unspecified / loopback
  // fe80::/10 link-local  → fe8 fe9 fea feb
  if (/^fe[89ab]/.test(s)) return false;
  if (s.startsWith("fc") || s.startsWith("fd")) return false; // fc00::/7 ULA
  if (s.startsWith("ff")) return false; // ff00::/8 multicast
  return true;
}

export function isPublicIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return false; // this-net / private / loopback
  if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // private /12
  if (a === 192 && b === 168) return false; // private /16
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a >= 224) return false; // multicast + reserved + 255.255.255.255 broadcast
  return true;
}

/** Injectable resolver — real DNS in prod, a mock in tests. `all:true` so a
 *  hostname that resolves to a mix of public and private is rejected on the
 *  private one, not silently accepted on whichever came first. */
export type AddressResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export const defaultResolver: AddressResolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Resolve `hostname` and return a single verified public IP, or null if it
 * does not resolve or ANY resolved address is non-public. Returning a concrete
 * IP (not just a boolean) is what lets a caller connect by literal address and
 * close the DNS-rebinding window (webhooks.ts does exactly that).
 */
export async function resolvePublicTarget(
  hostname: string,
  resolve: AddressResolver = defaultResolver,
): Promise<{ ip: string; family: 4 | 6 } | null> {
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolve(hostname);
  } catch {
    return null; // NXDOMAIN / SERVFAIL → do not egress
  }
  if (!addrs || addrs.length === 0) return null;
  for (const a of addrs) {
    if (!isPublicUnicastIp(a.address)) return null; // any private address → abort
  }
  const first = addrs[0];
  return { ip: first.address, family: first.family === 6 ? 6 : 4 };
}
