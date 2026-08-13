// Unit tests for the framework-agnostic trust gate (node:test, no framework).
// Run with `npm test` after `npm run build`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrustGate, VouchGateError } from "../dist/index.js";

const ADDR = "0x1111111111111111111111111111111111111111";
const CFG = { apiUrl: "https://vouch.test/api/v1", apiKey: "vk_test" };

// A fetch stub that returns a score body, records the URL it was called with.
function scoreFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => body,
    };
  };
  fn.calls = calls;
  return fn;
}

test("ALLOW recommendation → allow", async () => {
  const gate = createTrustGate({ ...CFG, fetch: scoreFetch({ trustScore: 80, recommendation: "ALLOW" }) });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "allow");
  assert.equal(d.score, 80);
  assert.equal(d.degraded, false);
});

test("BLOCK recommendation → block", async () => {
  const gate = createTrustGate({ ...CFG, fetch: scoreFetch({ trustScore: 12, recommendation: "BLOCK" }) });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "recommendation_block");
});

test("WARN recommendation → block by default (0.2.0 ALLOW-only)", async () => {
  const gate = createTrustGate({ ...CFG, fetch: scoreFetch({ trustScore: 55, recommendation: "WARN" }) });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "recommendation_not_allow");
});

test("policy block-only: WARN → warn (explicit opt-out, allowed downstream)", async () => {
  const gate = createTrustGate({
    ...CFG,
    policy: "block-only",
    fetch: scoreFetch({ trustScore: 55, recommendation: "WARN" }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "warn");
});

test("policy custom: warnOn/blockOn arrays band as configured", async () => {
  const gate = createTrustGate({
    ...CFG,
    policy: "custom",
    blockOn: ["BLOCK"],
    warnOn: ["WARN"],
    fetch: scoreFetch({ trustScore: 55, recommendation: "WARN" }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "warn");
});

test("blockOn/warnOn without policy custom are rejected, not silently ignored", () => {
  assert.throws(
    () => createTrustGate({ ...CFG, warnOn: ["WARN"] }),
    (e) => e instanceof VouchGateError && e.code === "invalid_policy_combination",
  );
  assert.throws(
    () => createTrustGate({ ...CFG, policy: "block-only", blockOn: ["BLOCK"] }),
    (e) => e instanceof VouchGateError && e.code === "invalid_policy_combination",
  );
});

test("minScore floor blocks an otherwise-ALLOW verdict", async () => {
  const gate = createTrustGate({ ...CFG, minScore: 70, fetch: scoreFetch({ trustScore: 65, recommendation: "ALLOW" }) });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "below_min_score");
});

test("wallet source is the default endpoint", async () => {
  const f = scoreFetch({ trustScore: 80, recommendation: "ALLOW" });
  const gate = createTrustGate({ ...CFG, fetch: f });
  await gate.evaluate(ADDR);
  assert.ok(f.calls[0].url.endsWith(`/wallets/${ADDR}/score`));
});

test("payee source hits the payee endpoint and reads `score`", async () => {
  const f = scoreFetch({ score: 42, recommendation: "WARN" });
  const gate = createTrustGate({ ...CFG, scoreSource: "payee", fetch: f });
  const d = await gate.evaluate(ADDR);
  assert.ok(f.calls[0].url.endsWith(`/payees/${ADDR}/score`));
  assert.equal(d.score, 42);
});

test("fail-closed (default): lookup failure blocks and is flagged degraded", async () => {
  const gate = createTrustGate({
    ...CFG,
    fetch: async () => {
      throw new Error("network down");
    },
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.degraded, true);
  assert.equal(d.reason, "vouch_unreachable");
});

test("fail-open: lookup failure allows, still flagged degraded", async () => {
  const gate = createTrustGate({
    ...CFG,
    failMode: "open",
    fetch: async () => {
      throw new Error("network down");
    },
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "allow");
  assert.equal(d.degraded, true);
});

test("non-2xx is a lookup failure, not a silent allow", async () => {
  const gate = createTrustGate({ ...CFG, fetch: scoreFetch({}, { ok: false, status: 500 }) });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "vouch_http_500");
});

test("200 with no recommendation is treated as degraded, never allowed", async () => {
  const gate = createTrustGate({ ...CFG, fetch: scoreFetch({ trustScore: 90 }) });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "vouch_no_recommendation");
});

test("invalid address throws VouchGateError (a caller bug, not a verdict)", async () => {
  const gate = createTrustGate({ ...CFG, fetch: scoreFetch({ trustScore: 80, recommendation: "ALLOW" }) });
  await assert.rejects(() => gate.evaluate("not-an-address"), (e) => e instanceof VouchGateError && e.code === "invalid_address");
});

test("missing apiUrl / apiKey throw at construction", () => {
  assert.throws(() => createTrustGate({ apiUrl: "", apiKey: "x" }), VouchGateError);
  assert.throws(() => createTrustGate({ apiUrl: "x", apiKey: "" }), VouchGateError);
});

test("out-of-range minScore is rejected at construction", () => {
  assert.throws(() => createTrustGate({ ...CFG, minScore: 200 }), VouchGateError);
});

test("attest posts to the settlement endpoint and returns ok", async () => {
  const f = scoreFetch({ ok: true, created: true });
  const gate = createTrustGate({ ...CFG, fetch: f });
  const ok = await gate.attest({
    wallet: ADDR,
    txHash: "0x" + "a".repeat(64),
  });
  assert.equal(ok, true);
  assert.ok(f.calls[0].url.endsWith("/payments/x402"));
  assert.equal(f.calls[0].init.method, "POST");
});

test("attest with a malformed tx hash returns false without a network call", async () => {
  const f = scoreFetch({ ok: true });
  const gate = createTrustGate({ ...CFG, fetch: f });
  const ok = await gate.attest({ wallet: ADDR, txHash: "0xshort" });
  assert.equal(ok, false);
  assert.equal(f.calls.length, 0);
});

// ============================================================
// H-4 (2026-08-13 R4) — middleware ↔ SpendGuard symmetry. The gate read only
// trustScore/score/recommendation and ignored the same body's `degraded`,
// `signalsUnavailable`, `scoredAt`/`cacheExpiresAt` fields that SpendGuard
// denies on. A 200 response that carried a recommendation while ALSO saying
// `degraded:true` was therefore banded on the recommendation and could ALLOW.
// The gate must treat a degraded/partial/stale server read fail-closed too.
// ============================================================

const fresh = () => ({
  scoredAt: new Date().toISOString(),
  cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
});

test("H-4: a degraded read blocks even with an ALLOW recommendation", async () => {
  const gate = createTrustGate({
    ...CFG,
    fetch: scoreFetch({ score: 80, recommendation: "ALLOW", degraded: true, ...fresh() }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "score_degraded");
  assert.equal(d.degraded, true);
});

test("H-4: a degraded read blocks even under fail-open (a real refusal, not an outage)", async () => {
  const gate = createTrustGate({
    ...CFG,
    failMode: "open",
    fetch: scoreFetch({ score: 80, recommendation: "ALLOW", degraded: true, ...fresh() }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "score_degraded");
});

test("H-4: a degraded read blocks even under block-only", async () => {
  const gate = createTrustGate({
    ...CFG,
    policy: "block-only",
    fetch: scoreFetch({ score: 80, recommendation: "ALLOW", degraded: true, ...fresh() }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "score_degraded");
});

test("H-4: allow-only blocks a partial measurement (signalsUnavailable non-empty)", async () => {
  const gate = createTrustGate({
    ...CFG,
    fetch: scoreFetch({
      score: 80,
      recommendation: "ALLOW",
      signalsUnavailable: ["drain_check"],
      ...fresh(),
    }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "partial_measurement");
  assert.equal(d.degraded, false); // a real, if partial, measurement
});

test("H-4: block-only tolerates a partial measurement (mirrors SpendGuard)", async () => {
  const gate = createTrustGate({
    ...CFG,
    policy: "block-only",
    fetch: scoreFetch({
      score: 80,
      recommendation: "ALLOW",
      signalsUnavailable: ["drain_check"],
      ...fresh(),
    }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "allow");
});

test("H-4/H-2: a stale score (past its cacheExpiresAt) blocks fail-closed", async () => {
  const gate = createTrustGate({
    ...CFG,
    fetch: scoreFetch({
      score: 80,
      recommendation: "ALLOW",
      scoredAt: new Date(Date.now() - 600000).toISOString(),
      cacheExpiresAt: new Date(Date.now() - 300000).toISOString(),
    }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "score_stale");
});

test("H-4/H-2: a score older than maxScoreAgeMs blocks", async () => {
  const gate = createTrustGate({
    ...CFG,
    maxScoreAgeMs: 30_000,
    fetch: scoreFetch({
      score: 80,
      recommendation: "ALLOW",
      scoredAt: new Date(Date.now() - 60000).toISOString(),
      cacheExpiresAt: new Date(Date.now() + 300000).toISOString(),
    }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "block");
  assert.equal(d.reason, "score_stale");
});

test("H-4: a fresh, clean ALLOW still passes (no false positives)", async () => {
  const gate = createTrustGate({
    ...CFG,
    fetch: scoreFetch({ score: 80, recommendation: "ALLOW", signalsUnavailable: [], ...fresh() }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "allow");
  assert.equal(d.degraded, false);
});

test("H-4: a body with no freshness fields is not spuriously stale (back-compat)", async () => {
  // The /wallets beacon may not carry scoredAt/cacheExpiresAt; absence must
  // not be read as staleness or the gate would block every such response.
  const gate = createTrustGate({
    ...CFG,
    fetch: scoreFetch({ trustScore: 80, recommendation: "ALLOW" }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "allow");
});

test("H-4: custom policy keeps pre-0.2.0 banding (no degraded/stale enforcement)", async () => {
  const gate = createTrustGate({
    ...CFG,
    policy: "custom",
    blockOn: ["BLOCK"],
    warnOn: ["WARN"],
    fetch: scoreFetch({ score: 80, recommendation: "ALLOW", degraded: true, ...fresh() }),
  });
  const d = await gate.evaluate(ADDR);
  assert.equal(d.action, "allow");
});

test("H-4: maxScoreAgeMs out of range is rejected at construction", () => {
  assert.throws(() => createTrustGate({ ...CFG, maxScoreAgeMs: 0 }), VouchGateError);
  assert.throws(() => createTrustGate({ ...CFG, maxScoreAgeMs: -5 }), VouchGateError);
});
