// ============================================================
// vet402 Observatory — L1 budget guard SKELETON (design §8, WO step 5).
//
// No caller exists yet (real purchasing is W3, a separate WO, after funding
// approval). The guard ships FIRST so the purchasing code, whenever it lands,
// has to pass through an already-tested fail-closed gate rather than growing
// its own. Fail-closed means: disabled by default, denied on missing or
// malformed inputs, denied at the cap — never "allow because unsure".
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_BUDGET_USD,
  isL1Enabled,
  checkL1Budget,
} from "@/lib/observatory/budget";

test("L1 is disabled unless the env flag is exactly 'true'", () => {
  const saved = process.env.OBSERVATORY_L1_ENABLED;
  delete process.env.OBSERVATORY_L1_ENABLED;
  assert.equal(isL1Enabled(), false, "unset → OFF");
  process.env.OBSERVATORY_L1_ENABLED = "1";
  assert.equal(isL1Enabled(), false, "'1' → OFF (only the explicit word)");
  process.env.OBSERVATORY_L1_ENABLED = "TRUE";
  assert.equal(isL1Enabled(), false, "case matters — no accidental enable");
  process.env.OBSERVATORY_L1_ENABLED = "true";
  assert.equal(isL1Enabled(), true);
  if (saved === undefined) delete process.env.OBSERVATORY_L1_ENABLED;
  else process.env.OBSERVATORY_L1_ENABLED = saved;
});

test("the daily cap is $25 and the guard denies at the boundary", () => {
  const saved = process.env.OBSERVATORY_L1_ENABLED;
  process.env.OBSERVATORY_L1_ENABLED = "true";

  assert.equal(DAILY_BUDGET_USD, 25);
  assert.equal(checkL1Budget({ spentTodayUsd: 0, requestUsd: 1 }).allowed, true);
  assert.equal(checkL1Budget({ spentTodayUsd: 24, requestUsd: 1 }).allowed, true, "exactly at cap OK");
  const over = checkL1Budget({ spentTodayUsd: 24.01, requestUsd: 1 });
  assert.equal(over.allowed, false);
  assert.equal(over.reason, "daily_budget_exceeded");

  if (saved === undefined) delete process.env.OBSERVATORY_L1_ENABLED;
  else process.env.OBSERVATORY_L1_ENABLED = saved;
});

test("fail-closed: disabled flag, malformed or negative inputs all deny", () => {
  const saved = process.env.OBSERVATORY_L1_ENABLED;
  delete process.env.OBSERVATORY_L1_ENABLED;
  assert.equal(checkL1Budget({ spentTodayUsd: 0, requestUsd: 1 }).allowed, false);
  assert.equal(checkL1Budget({ spentTodayUsd: 0, requestUsd: 1 }).reason, "l1_disabled");

  process.env.OBSERVATORY_L1_ENABLED = "true";
  assert.equal(checkL1Budget({ spentTodayUsd: NaN, requestUsd: 1 }).allowed, false);
  assert.equal(checkL1Budget({ spentTodayUsd: 0, requestUsd: NaN }).allowed, false);
  assert.equal(checkL1Budget({ spentTodayUsd: -5, requestUsd: 1 }).allowed, false);
  assert.equal(checkL1Budget({ spentTodayUsd: 0, requestUsd: 0 }).allowed, false);
  assert.equal(checkL1Budget({ spentTodayUsd: 0, requestUsd: -1 }).allowed, false);

  if (saved === undefined) delete process.env.OBSERVATORY_L1_ENABLED;
  else process.env.OBSERVATORY_L1_ENABLED = saved;
});
