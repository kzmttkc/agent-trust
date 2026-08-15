// ============================================================
// /api/health is key-less and does REAL work.
//
// 2026-08-15 audit. Every other key-less path (/api/demo/score, /api/badge/:a,
// /api/v1/accuracy, /api/v1/payees/verify, /api/signup) was given a per-IP
// limiter in the 2026-08-06 pass. /api/health was not — and it is the most
// expensive of them: the shallow liveness answer runs the seller-side scoring
// probe AND the payee probe, i.e. Base RPC + Blockscout + DB reads.
//
// The 60s memoisation is per function INSTANCE, so it does not bound a flood:
// concurrent requests fan out to cold instances that each pay the full probe.
// Blockscout's limiter is a documented global penalty box (see
// src/lib/chain/blockscout.ts) — an anonymous flood here can therefore push
// the product's own scoring into cooldown. That is availability damage bought
// with no credentials.
//
// The ceiling is deliberately far above any honest poller (docs tell customers
// to point an uptime monitor here; 60/min is one request per second) so the
// fix cannot turn a monitor green→red on its own.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";
import { GET as health } from "@/app/api/health/route";
// Constants live in ./liveness, not in the route module: a Next route file may
// only export handlers and segment config.
import { HEALTH_RATE_LIMIT, HEALTH_RATE_WINDOW_MS } from "@/app/api/health/liveness";

test("a key-less flood is throttled before it can spend an upstream call", async () => {
  // TRUST_PROXY_HEADERS is unset here, so getClientIp() === "unknown" and the
  // bucket key is deterministic: exhaust it directly rather than by driving 60
  // real probe runs.
  for (let i = 0; i < HEALTH_RATE_LIMIT; i++) {
    await consumeIpRateLimit("health:unknown", HEALTH_RATE_LIMIT, HEALTH_RATE_WINDOW_MS);
  }

  const response = await health(new NextRequest("http://localhost/api/health"));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("RateLimit-Limit"), String(HEALTH_RATE_LIMIT));
  assert.ok(response.headers.get("Retry-After"), "a throttled poller is told when to come back");
  // The probes must not have run: reaching them is the cost this gate exists
  // to refuse. A 429 body carrying a status would mean we measured anyway.
  assert.deepEqual(await response.json(), { status: "rate_limited" });
});
