// ============================================================
// Vouch — deadline helper.
//
// WHY THIS EXISTS (2026-08-12 incident). Every optional chain signal in the
// scoring engine was already wrapped in try/catch so an unavailable upstream
// degrades to an `*_unavailable` flag — the documented "fail-closed, not
// fail-wrong" contract. But try/catch catches REJECTIONS, not SLOWNESS: a
// dependency that takes 30s instead of throwing sails straight past the
// handler and burns the caller's entire time budget. That is precisely how
// /api/demo/score and /agent/[id] died in production — the 7-day eth_getLogs
// scan took 30s against an 8s race, so the honest degradation path never ran
// and the whole request timed out into "Score unavailable".
//
// A deadline converts slowness into a rejection, which is the ONLY shape the
// existing degradation logic can act on.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { withDeadline, DeadlineExceededError } from "@/lib/util/deadline";

test("passes a value through unchanged when it settles inside the deadline", async () => {
  const result = await withDeadline(
    Promise.resolve("fast"),
    1_000,
    "label",
  );
  assert.equal(result, "fast");
});

test("rejects with DeadlineExceededError when the work outlives the budget", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 5_000));
  await assert.rejects(
    () => withDeadline(slow, 20, "feedback_stats"),
    (error: unknown) => {
      assert.ok(error instanceof DeadlineExceededError);
      assert.match((error as Error).message, /feedback_stats/);
      return true;
    },
  );
});

test("preserves the original rejection rather than masking it as a deadline miss", async () => {
  const boom = Promise.reject(new Error("rpc_exploded"));
  await assert.rejects(
    () => withDeadline(boom, 1_000, "label"),
    (error: unknown) => {
      assert.ok(!(error instanceof DeadlineExceededError));
      assert.equal((error as Error).message, "rpc_exploded");
      return true;
    },
  );
});

test("clears its timer so a settled call cannot keep the process alive", async () => {
  // If the timeout handle leaked, node:test would hang past the run.
  const before = process.getActiveResourcesInfo?.().length ?? 0;
  await withDeadline(Promise.resolve(1), 60_000, "label");
  const after = process.getActiveResourcesInfo?.().length ?? 0;
  assert.ok(after <= before, `timer leaked: ${before} -> ${after}`);
});

test("a deadline of zero or less does not disable the budget", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
  await assert.rejects(() => withDeadline(slow, 0, "zero"), DeadlineExceededError);
});
