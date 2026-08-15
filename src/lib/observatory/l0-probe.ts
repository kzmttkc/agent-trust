// ============================================================
// vet402 Observatory L0 — no-purchase probe (design §4).
//
// What a probe is: one request sent with the CATALOG-DECLARED method,
// expecting the x402 payment wall (HTTP 402 + parseable accepts[]) to stop
// it before anything executes. The 402 itself is the observable — no
// payment is ever attached, so a healthy endpoint bills nothing and runs
// nothing.
//
// #3113 guard (the module's founding constraint):
//   - method comes from the catalog declaration, NEVER guessed;
//   - undeclared method → no request at all, verdict `unverified`;
//   - POST probes carry an empty JSON body — the x402 wall sits in front of
//     the handler, so a compliant server answers 402 before parsing. If a
//     server instead answers 2xx, that fact is recorded (no_402) and the
//     prober does NOT retry — one accidental execution is one too many.
//
// Verdict vocabulary is closed: pass | fail | unverified.
//   fail-closed direction is toward `unverified` — "no proof" ≠ "dead".
// Publication additionally gates single fails (legal multiple-measurement
// condition): see publishedVerdict().
// ============================================================

import { UnsafeTargetError, createSafeFetchImpl } from "@/lib/net/safe-fetch";

export type ProbeTarget = {
  resourceUrl: string;
  /** Catalog-declared method or null (undeclared → unverified, no request). */
  method: string | null;
  /** Catalog-declared facts to cross-check against the live 402 challenge. */
  payTo: string | null;
  network: string | null;
  priceAmount: string | null;
  priceAsset: string | null;
};

export type ProbeResult = {
  method: string;
  verdict: "pass" | "fail" | "unverified";
  httpStatus: number | null;
  has402Challenge: boolean | null;
  acceptsValid: boolean | null;
  /** null = catalog declared no price → nothing to compare (skip ≠ fail). */
  priceConsistent: boolean | null;
  metadataConsistent: boolean | null;
  latencyMs: number | null;
  failReason: string | null;
  rawResponseMeta: Record<string, unknown> | null;
};

export type ProbeOptions = {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

// SSRF (2026-08-15 audit). resourceUrl is third-party input: it is whatever a
// seller declared to the public Bazaar catalog, copied verbatim into our DB.
// The production default fetch therefore refuses any target that is — or
// redirects to — a non-public address, so a listed
// `http://169.254.169.254/latest/meta-data/…` costs zero requests instead of
// being fetched on schedule with 500 bytes of the reply stored in
// x402_l0_probes.raw_response_meta. Tests inject their own fetchImpl and are
// exercising the parse/verdict logic, not the network policy — that has its
// own tests in tests/outbound-ssrf.test.ts.
const guardedFetch = createSafeFetchImpl();

/** Published-fail gate: fewer consecutive fails than this renders as `unverified`. */
export const MIN_CONSECUTIVE_FAILS_TO_PUBLISH = 2;

/**
 * The verdict the PUBLIC page may show, from probe verdicts ordered newest
 * first. A pass or unverified passes through; a fail is only publishable
 * when the newest MIN_CONSECUTIVE_FAILS_TO_PUBLISH probes all failed —
 * a single fail (transient blip, our own network hiccup) must never brand
 * an endpoint dead in public.
 */
export function publishedVerdict(newestFirst: readonly string[]): "pass" | "fail" | "unverified" {
  const latest = newestFirst[0];
  if (latest === "pass") return "pass";
  if (latest === "fail") {
    let streak = 0;
    for (const v of newestFirst) {
      if (v !== "fail") break;
      streak++;
    }
    return streak >= MIN_CONSECUTIVE_FAILS_TO_PUBLISH ? "fail" : "unverified";
  }
  return "unverified";
}

function classifyNetworkError(
  error: unknown,
): "dns" | "tls" | "timeout" | "network" | "unsafe_target" | "redirect_limit" {
  // The guard fired before (or between) sockets. `unresolvable` is reported as
  // `dns` because that is exactly what the unguarded fetch used to report for
  // the same catalog row — the reason code must not change meaning just
  // because the check moved earlier.
  if (error instanceof UnsafeTargetError) {
    if (error.reason === "unresolvable") return "dns";
    if (error.reason === "too_many_redirects") return "redirect_limit";
    return "unsafe_target";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  // undici wraps the syscall error in TypeError.cause with a `code`.
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const code = typeof cause === "object" && cause !== null ? String((cause as { code?: unknown }).code ?? "") : "";
  const msg = cause instanceof Error ? cause.message : "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || /certificate|TLS|SSL/i.test(msg))
    return "tls";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return "timeout";
  return "network";
}

type ChallengeAccept = {
  amount?: unknown;
  asset?: unknown;
  network?: unknown;
  payTo?: unknown;
  recipient?: unknown;
};

function parseAccepts(body: string): ChallengeAccept[] | null {
  try {
    const parsed = JSON.parse(body);
    const accepts = (parsed as { accepts?: unknown })?.accepts;
    if (!Array.isArray(accepts) || accepts.length === 0) return null;
    return accepts as ChallengeAccept[];
  } catch {
    return null;
  }
}

const lower = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.toLowerCase() : null);

export async function probeEndpoint(
  target: ProbeTarget,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const { fetchImpl = guardedFetch, timeoutMs = 10_000 } = options;

  if (!target.method) {
    return {
      method: "NONE",
      verdict: "unverified",
      httpStatus: null,
      has402Challenge: null,
      acceptsValid: null,
      priceConsistent: null,
      metadataConsistent: null,
      latencyMs: null,
      failReason: "method_undeclared",
      rawResponseMeta: null,
    };
  }

  const method = target.method.toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchImpl(target.resourceUrl, {
      method,
      signal: controller.signal,
      // The guarded default follows redirects itself, re-checking each hop
      // (safe-fetch.ts); it overrides this to "manual" so the platform cannot
      // follow one for us. Left declared for an injected fetchImpl.
      redirect: "follow",
      headers: { accept: "application/json", "user-agent": "vet402-observatory-l0/1.0 (+https://vet402.com/observatory/methodology)" },
      // Empty JSON body on POST: the x402 wall answers 402 before the handler
      // parses anything, so this cannot trigger work on a compliant server.
      ...(method === "POST" ? { body: "{}", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "vet402-observatory-l0/1.0 (+https://vet402.com/observatory/methodology)" } } : {}),
    });
  } catch (error) {
    const reason = classifyNetworkError(error);
    return {
      method,
      // A target we REFUSED to contact is not a measurement of the seller:
      // `unverified` (no proof), never `fail` (a published claim). Same
      // fail-closed direction as method_undeclared.
      verdict: reason === "unsafe_target" ? "unverified" : "fail",
      httpStatus: null,
      // `false` would assert we looked and saw no wall; on a refused target we
      // never looked.
      has402Challenge: reason === "unsafe_target" ? null : false,
      acceptsValid: null,
      priceConsistent: null,
      metadataConsistent: null,
      latencyMs: Date.now() - startedAt,
      failReason: reason,
      rawResponseMeta: { error: reason },
    };
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - startedAt;
  let bodyText = "";
  try {
    bodyText = (await response.text()).slice(0, 4_000);
  } catch {
    bodyText = "";
  }
  const meta: Record<string, unknown> = {
    status: response.status,
    contentType: response.headers.get("content-type"),
    server: response.headers.get("server"),
    bodyHead: bodyText.slice(0, 500),
  };

  if (response.status !== 402) {
    return {
      method,
      verdict: "fail",
      httpStatus: response.status,
      has402Challenge: false,
      acceptsValid: null,
      priceConsistent: null,
      metadataConsistent: null,
      latencyMs,
      failReason: "no_402",
      rawResponseMeta: meta,
    };
  }

  const accepts = parseAccepts(bodyText);
  if (!accepts) {
    return {
      method,
      verdict: "fail",
      httpStatus: 402,
      has402Challenge: true,
      acceptsValid: false,
      priceConsistent: null,
      metadataConsistent: null,
      latencyMs,
      failReason: "accepts_invalid",
      rawResponseMeta: meta,
    };
  }

  // Cross-check the live challenge against the catalog declaration. The
  // challenge may carry several accepts; we look for ANY that matches. A
  // declaration the catalog never made is not checkable → null (skip ≠ fail).
  const declaredPrice = target.priceAmount !== null || target.priceAsset !== null;
  const declaredMeta = target.payTo !== null || target.network !== null;

  const priceConsistent = declaredPrice
    ? accepts.some(
        (a) =>
          (target.priceAmount === null || String(a.amount) === target.priceAmount) &&
          (target.priceAsset === null || lower(a.asset) === lower(target.priceAsset)),
      )
    : null;

  const metadataConsistent = declaredMeta
    ? accepts.some(
        (a) =>
          (target.payTo === null || lower(a.payTo) === target.payTo || lower(a.recipient) === target.payTo) &&
          (target.network === null || a.network === target.network),
      )
    : null;

  if (priceConsistent === false) {
    return {
      method,
      verdict: "fail",
      httpStatus: 402,
      has402Challenge: true,
      acceptsValid: true,
      priceConsistent,
      metadataConsistent,
      latencyMs,
      failReason: "price_mismatch",
      rawResponseMeta: meta,
    };
  }
  if (metadataConsistent === false) {
    return {
      method,
      verdict: "fail",
      httpStatus: 402,
      has402Challenge: true,
      acceptsValid: true,
      priceConsistent,
      metadataConsistent,
      latencyMs,
      failReason: "metadata_mismatch",
      rawResponseMeta: meta,
    };
  }

  return {
    method,
    verdict: "pass",
    httpStatus: 402,
    has402Challenge: true,
    acceptsValid: true,
    priceConsistent,
    metadataConsistent,
    latencyMs,
    failReason: null,
    rawResponseMeta: meta,
  };
}
