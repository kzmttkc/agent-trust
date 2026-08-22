// ============================================================
// Forwarded-IP trust — which header this deployment may believe.
//
// WHY (2026-08-22 audit). TRUST_PROXY_HEADERS=true said "there is a proxy in
// front of me"; getClientIp read it as "that proxy is Vercel" and trusted
// x-vercel-forwarded-for unconditionally. On Vercel the platform overwrites
// that header, so it is sound. Off Vercel — and docker-compose shipped
// TRUST_PROXY_HEADERS=true as its DEFAULT — nothing overwrites it, so one
// request header bought a fresh identity and every per-IP limit (login,
// signup, admin, demo/verify's one live purchase per IP per day) stopped
// existing.
//
// Fixed here: a spoofed header must resolve to "unknown", and the Vercel
// production path must keep behaving exactly as it did.
// ============================================================
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getClientIp } from "@/lib/api/client-ip";
import { resolveProxyHeaderSource } from "@/lib/config/proxy-headers";
import { collectProxyHeaderIssues } from "@/lib/config/production-env";

const TOUCHED = [
  "PROXY_HEADER_SOURCE",
  "TRUST_PROXY_HEADERS",
  "TRUST_GENERIC_FORWARDED_FOR",
  "VERCEL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of TOUCHED) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TOUCHED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

function req(headers: Record<string, string>): Request {
  return new Request("https://vet402.com/api/v1/demo/verify", { headers });
}

const SPOOF = {
  "x-vercel-forwarded-for": "1.2.3.4",
  "x-forwarded-for": "5.6.7.8",
  "x-real-ip": "9.10.11.12",
};

// ---- the bypass ------------------------------------------------------------

test("self-host default: every forwarded header is a spoof and resolves to unknown", () => {
  // No PROXY_HEADER_SOURCE, no VERCEL — a bare `docker compose up`.
  assert.equal(resolveProxyHeaderSource(), "none");
  assert.equal(getClientIp(req(SPOOF)), "unknown");
});

test("legacy TRUST_PROXY_HEADERS=true off Vercel no longer buys the vercel header", () => {
  process.env.TRUST_PROXY_HEADERS = "true";
  assert.equal(resolveProxyHeaderSource(), "none");
  assert.equal(getClientIp(req(SPOOF)), "unknown");
});

test("PROXY_HEADER_SOURCE=none ignores headers even on Vercel", () => {
  process.env.VERCEL = "1";
  process.env.PROXY_HEADER_SOURCE = "none";
  assert.equal(getClientIp(req(SPOOF)), "unknown");
});

test("an unparseable PROXY_HEADER_SOURCE fails closed, it does not fall back to the legacy guess", () => {
  process.env.PROXY_HEADER_SOURCE = "yes-please";
  process.env.TRUST_PROXY_HEADERS = "true";
  process.env.VERCEL = "1";
  assert.equal(resolveProxyHeaderSource(), "none");
  assert.equal(getClientIp(req(SPOOF)), "unknown");
});

// ---- production (Vercel) behaviour is unchanged ----------------------------

test("Vercel + legacy TRUST_PROXY_HEADERS=true still resolves to vercel and reads the platform header", () => {
  process.env.VERCEL = "1";
  process.env.TRUST_PROXY_HEADERS = "true";
  assert.equal(resolveProxyHeaderSource(), "vercel");
  assert.equal(getClientIp(req(SPOOF)), "1.2.3.4");
});

test("vercel mode takes the first entry of a comma list and ignores the generic headers", () => {
  process.env.PROXY_HEADER_SOURCE = "vercel";
  assert.equal(
    getClientIp(req({ "x-vercel-forwarded-for": "203.0.113.7, 70.41.3.18" })),
    "203.0.113.7",
  );
  // Generic headers alone prove nothing in vercel mode.
  assert.equal(getClientIp(req({ "x-forwarded-for": "5.6.7.8" })), "unknown");
});

// ---- generic mode ----------------------------------------------------------

test("generic mode reads x-real-ip then x-forwarded-for, never the vercel header", () => {
  process.env.PROXY_HEADER_SOURCE = "generic";
  assert.equal(getClientIp(req({ "x-real-ip": "9.10.11.12" })), "9.10.11.12");
  assert.equal(getClientIp(req({ "x-forwarded-for": "5.6.7.8, 1.1.1.1" })), "5.6.7.8");
  assert.equal(getClientIp(req({ "x-vercel-forwarded-for": "1.2.3.4" })), "unknown");
});

test("legacy TRUST_PROXY_HEADERS + TRUST_GENERIC_FORWARDED_FOR off Vercel infers generic", () => {
  process.env.TRUST_PROXY_HEADERS = "true";
  process.env.TRUST_GENERIC_FORWARDED_FOR = "true";
  assert.equal(resolveProxyHeaderSource(), "generic");
  assert.equal(getClientIp(req(SPOOF)), "9.10.11.12");
});

// ---- the production guard --------------------------------------------------

function messages(level: "error" | "warn"): string[] {
  return collectProxyHeaderIssues()
    .filter((issue) => issue.level === level)
    .map((issue) => issue.message);
}

test("PROXY_HEADER_SOURCE=vercel off Vercel is a boot ERROR", () => {
  process.env.PROXY_HEADER_SOURCE = "vercel";
  const errors = messages("error");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /only Vercel overwrites/);
});

test("PROXY_HEADER_SOURCE=vercel on Vercel raises nothing", () => {
  process.env.PROXY_HEADER_SOURCE = "vercel";
  process.env.VERCEL = "1";
  assert.deepEqual(collectProxyHeaderIssues(), []);
});

test("today's production env (TRUST_PROXY_HEADERS=true on Vercel) boots — deprecation warning only", () => {
  process.env.VERCEL = "1";
  process.env.TRUST_PROXY_HEADERS = "true";
  assert.deepEqual(messages("error"), []);
  assert.equal(messages("warn").length, 1);
  assert.match(messages("warn")[0], /PROXY_HEADER_SOURCE=vercel/);
});

test("an unset/uninferable source warns rather than failing boot", () => {
  // Deliberate: the inference depends on VERCEL=1 being present, and a
  // missing platform variable must degrade the rate limiter, not the deploy.
  assert.deepEqual(messages("error"), []);
  assert.equal(messages("warn").length, 1);
});

test("a typo'd source is an error, not a silent none", () => {
  process.env.PROXY_HEADER_SOURCE = "vercell";
  const errors = messages("error");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must be one of vercel\|generic\|none/);
});

test("generic in production warns that the header is spoofable", () => {
  process.env.PROXY_HEADER_SOURCE = "generic";
  assert.deepEqual(messages("error"), []);
  assert.match(messages("warn")[0], /spoofable/);
});
