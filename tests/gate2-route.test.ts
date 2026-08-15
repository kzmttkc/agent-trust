// ============================================================
// /api/admin/gate2 — the sibling admin route (global-lists) gates every verb
// behind a per-IP rate limit BEFORE the admin bearer check (adminGate() in
// global-lists/route.ts). gate2 only had the bearer check: ADMIN_SECRET is
// long and low-entropy-rejected so brute force is impractical, but an
// unauthenticated flood still reaches authorizeAdmin() on every request with
// no ceiling — defense-in-depth parity with the sibling route, not a response
// to a demonstrated brute-force risk.
//
// 2026-08-15 audit.
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";
import { GET as gate2 } from "@/app/api/admin/gate2/route";

const SECRET = "test-admin-secret-gate2-audit";

afterEach(() => {
  delete process.env.ADMIN_SECRET;
});

// Both tests share one in-memory bucket (TRUST_PROXY_HEADERS is unset, so
// getClientIp() === "unknown" for every request) — order matters. This one
// runs first, while the bucket still has room, so it genuinely exercises the
// bearer check rather than getting a 429 from the other test's flood.
test("a request within the limit still requires the admin bearer", async () => {
  process.env.ADMIN_SECRET = SECRET;
  const res = await gate2(new NextRequest("http://localhost/api/admin/gate2"));
  assert.equal(res.status, 403);
});

test("an unauthenticated flood is throttled before reaching the bearer check", async () => {
  process.env.ADMIN_SECRET = SECRET;
  for (let i = 0; i < 30; i++) {
    await consumeIpRateLimit("admin:unknown", 30, 60_000);
  }

  const res = await gate2(new NextRequest("http://localhost/api/admin/gate2"));

  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.error, "rate_limit_exceeded");
  assert.equal(typeof body.retryAfter, "number");
});
