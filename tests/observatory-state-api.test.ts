// ============================================================
// vet402 — State-of-x402 JSON API (2026-08-18).
//
// Machine-readable twin of /observatory/state. These pin that the endpoint
// returns the aggregate figures with their denominators, the per-chain
// breakdown, and RateLimit headers — and never fabricates numbers (an empty
// DB returns zeros, not nulls-as-data). The reader math itself is covered in
// observatory-reader.test.ts against a real Postgres; this exercises the route
// wrapper's shape and headers.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

test("state API returns the aggregate shape with RateLimit headers", async () => {
  const { GET } = await import("@/app/api/v1/observatory/state/route");
  const res = await GET(new NextRequest("http://localhost/api/v1/observatory/state"));
  // With no DATABASE_URL in this unit context the readers degrade to empty —
  // the route must still answer 200 with a well-formed, honest zero state,
  // never a 500.
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("RateLimit-Limit"), "RateLimit-Limit present");

  const body = await res.json();
  for (const key of [
    "totalEndpoints",
    "activeEndpoints",
    "delistedEndpoints",
    "publishedPass",
    "publishedFail",
    "publishedUnverified",
  ]) {
    assert.equal(typeof body[key], "number", `${key} must be a number`);
  }
  assert.ok(Array.isArray(body.byChain), "byChain must be an array");
  assert.ok(body.l1 && typeof body.l1.attempts === "number", "l1 attempts present");
  // Facts-only contract: no evaluative vocabulary in the payload.
  const raw = JSON.stringify(body).toLowerCase();
  assert.ok(!raw.includes('"score"'), "payload must not carry a score field");
  assert.ok(typeof body.disclaimer === "string" && body.disclaimer.length > 0);
});
