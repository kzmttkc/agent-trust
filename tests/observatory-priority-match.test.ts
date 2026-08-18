// ============================================================
// vet402 Observatory L1 — priority-host matching (no DB).
//
// resource_key is host+path. A priority host must match ITSELF and any path
// UNDER it, but never a look-alike host that merely shares the prefix. The
// old `${host}%` pattern matched `api.exa.aique.com/paid` under `api.exa.ai`,
// which an attacker could register to hijack the daily L1 budget. This locks
// the boundary to an exact host or a `/` path segment.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPriorityResourceKey } from "@/lib/observatory/l1-runner";

test("priority match: the host itself and paths under it match", () => {
  assert.equal(isPriorityResourceKey("api.exa.ai"), true);
  assert.equal(isPriorityResourceKey("api.exa.ai/search"), true);
  assert.equal(isPriorityResourceKey("x402.twit.sh"), true);
  assert.equal(isPriorityResourceKey("x402.twit.sh/rpc"), true);
  assert.equal(isPriorityResourceKey("stableenrich.dev/quote"), true);
  assert.equal(isPriorityResourceKey("x402.tavily.com/search"), true);
  // Case-insensitive, mirroring SQL ILIKE.
  assert.equal(isPriorityResourceKey("API.EXA.AI/Search"), true);
});

test("priority match: look-alike sibling hosts DO NOT match (the bug)", () => {
  assert.equal(isPriorityResourceKey("api.exa.aique.com/paid"), false);
  assert.equal(isPriorityResourceKey("x402.twit.shady.io/x"), false);
  assert.equal(isPriorityResourceKey("api.exa.ai.evil.com/paid"), false);
  assert.equal(isPriorityResourceKey("stableenrich.dev.attacker.net/q"), false);
  assert.equal(isPriorityResourceKey("notapi.exa.ai/search"), false);
});
