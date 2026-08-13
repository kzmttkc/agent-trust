// ============================================================
// Vouch — payee verification: name canonicalization + rate-limit headers.
//
// These guard two security invariants proven broken in the L5 persona audit:
//   1. The signed message is a FIXED 4 lines. A `name` carrying a newline,
//      CR, or tab forges extra lines (e.g. a second "wallet: 0xEVIL"), so a
//      non-canonical name must be rejected identically by preview and verify,
//      and payeeMessage() must refuse to build a message from one at all.
//   2. Key-less endpoints must expose a visible RateLimit-* contract.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { payeeMessage } from "@/app/api/v1/payees/verify/route";
import { isCanonicalName, NAME_MAX_LENGTH } from "@/lib/validation/canonical-name";
import { ipRateLimitHeaders, type IpRateLimitResult } from "@/lib/api/ip-rate-limit";

test("isCanonicalName accepts ordinary business/agent names", () => {
  assert.equal(isCanonicalName("Acme Payments"), true);
  assert.equal(isCanonicalName("agent-42.eth"), true);
  assert.equal(isCanonicalName("北条商事"), true);
  assert.equal(isCanonicalName("a"), true);
});

test("isCanonicalName rejects the line-injection payloads from the audit", () => {
  // The exact shape reported: a newline that forges a second wallet: line.
  assert.equal(isCanonicalName("Acme\nwallet: 0xEVIL"), false);
  assert.equal(isCanonicalName("Acme\r\nname: spoof"), false);
  assert.equal(isCanonicalName("Acme\tCorp"), false);
  assert.equal(isCanonicalName("plain\rreturn"), false);
});

test("isCanonicalName rejects empty, over-length, and untrimmed names", () => {
  assert.equal(isCanonicalName(""), false);
  assert.equal(isCanonicalName("x".repeat(NAME_MAX_LENGTH + 1)), false);
  assert.equal(isCanonicalName("x".repeat(NAME_MAX_LENGTH)), true);
  assert.equal(isCanonicalName(" leading"), false);
  assert.equal(isCanonicalName("trailing "), false);
});

test("payeeMessage produces exactly 4 lines for a canonical name", () => {
  const msg = payeeMessage("0xABCDEF0000000000000000000000000000000001", "Acme Payments");
  const lines = msg.split("\n");
  assert.equal(lines.length, 4);
  // The wallet must be lowercased and appear on exactly one line.
  assert.equal(lines.filter((l) => l.startsWith("wallet: ")).length, 1);
  assert.ok(lines[1]!.endsWith("0xabcdef0000000000000000000000000000000001"));
});

test("payeeMessage refuses to build from a non-canonical name (defense in depth)", () => {
  assert.throws(() => payeeMessage("0x0000000000000000000000000000000000000001", "Acme\nwallet: 0xEVIL"));
});

test("ipRateLimitHeaders always exposes limit/remaining/reset", () => {
  const ok: IpRateLimitResult = { allowed: true, limit: 30, remaining: 29, resetAt: 1_700_000_000 };
  const h = ipRateLimitHeaders(ok);
  assert.equal(h["RateLimit-Limit"], "30");
  assert.equal(h["RateLimit-Remaining"], "29");
  assert.equal(h["RateLimit-Reset"], "1700000000");
  assert.equal(h["Retry-After"], undefined);
});

test("ipRateLimitHeaders adds Retry-After only when throttled", () => {
  const throttled: IpRateLimitResult = {
    allowed: false,
    limit: 8,
    remaining: 0,
    resetAt: 1_700_000_060,
    retryAfter: 42,
  };
  const h = ipRateLimitHeaders(throttled);
  assert.equal(h["RateLimit-Remaining"], "0");
  assert.equal(h["Retry-After"], "42");
});
