// ============================================================
// vet402 — buyer-side payee cache must not survive a drain (H-3, R4).
//
// The buyer-side payee score is cached for 5 minutes. A wallet that starts
// draining after a clean lookup keeps serving that pre-drain ALLOW to every
// buyer for up to the whole TTL — a time window in which agents pay a wallet
// vet402 already knows has turned. The monitoring heartbeat (watchlist scan)
// re-scores watched wallets and learns the verdict changed; that signal must
// also drop the wallet from the buyer-side payee cache so the next lookup
// recomputes. This tests the pure decision: WHICH wallet to invalidate, and
// only when the verdict actually worsened.
//
// TRADE-OFF (noted, not hidden): invalidatePayeeScoreCache clears only the
// in-process LRU of the instance that runs it. On a multi-instance deploy the
// payee engine's cache is not epoch-aware, so a fully cross-instance drop
// needs a scoring-side change (out of this layer's scope). This closes the
// same-instance window and gives the cron a real invalidation path.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isVerdictWorse,
  payeeCacheTargetForVerdictChange,
} from "@/lib/payee/cache-guard";

test("a verdict moving ALLOW→BLOCK is worse", () => {
  assert.equal(isVerdictWorse("ALLOW", "BLOCK"), true);
  assert.equal(isVerdictWorse("ALLOW", "WARN"), true);
  assert.equal(isVerdictWorse("WARN", "BLOCK"), true);
});

test("a verdict staying the same or improving is not worse", () => {
  assert.equal(isVerdictWorse("ALLOW", "ALLOW"), false);
  assert.equal(isVerdictWorse("BLOCK", "ALLOW"), false);
  assert.equal(isVerdictWorse("WARN", "ALLOW"), false);
  assert.equal(isVerdictWorse("BLOCK", "WARN"), false);
});

test("a first-ever verdict (no previous) does not trigger invalidation", () => {
  assert.equal(isVerdictWorse(null, "BLOCK"), false);
});

test("a worsened WALLET verdict yields the lowercased wallet to invalidate", () => {
  const target = payeeCacheTargetForVerdictChange({
    targetType: "wallet",
    target: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    previous: "ALLOW",
    current: "BLOCK",
  });
  assert.equal(target, "0xaabbccddeeff00112233445566778899aabbccdd");
});

test("an agent verdict change does not touch the payee (wallet-keyed) cache", () => {
  // The buyer-side payee cache is keyed by receiving wallet; an agentId is not
  // a payee cache key, so an agent verdict change must not be routed here.
  const target = payeeCacheTargetForVerdictChange({
    targetType: "agent",
    target: "42",
    previous: "ALLOW",
    current: "BLOCK",
  });
  assert.equal(target, null);
});

test("a non-worsening wallet verdict yields no invalidation", () => {
  const target = payeeCacheTargetForVerdictChange({
    targetType: "wallet",
    target: "0x1111111111111111111111111111111111111111",
    previous: "WARN",
    current: "ALLOW",
  });
  assert.equal(target, null);
});
