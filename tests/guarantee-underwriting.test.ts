// ============================================================
// N-20 guarantee underwriting — fail closed until the data earns the offer.
// A guarantee priced off insufficient or missing accuracy data is a
// financial false statement; every branch below defends that line.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CAP_USD,
  PREMIUM_FLOOR,
  UNDERWRITE_MIN_RESOLVED,
  underwrite,
} from "@/lib/guarantee/underwriting";
import type { AccuracyReport } from "@/lib/scoring/accuracy";

const base: AccuracyReport = {
  observedVerdicts: 300,
  resolvedVerdicts: 250,
  neutralOnlyVerdicts: 0,
  partnerReportedVerdicts: 10,
  byRecommendation: [],
  allowAdverseRate: 0.004,
  blockFalsePositiveRate: 0.01,
  minSample: 10,
  methodologyVersion: 1,
};

test("十分な実測＋低い損失率 → 提供可・上限は件数連動・保険料はフロア以上", () => {
  const q = underwrite(base);
  assert.equal(q.canOffer, true);
  assert.equal(q.maxCoverageUsd, 250);
  assert.ok((q.premiumRate ?? 0) >= PREMIUM_FLOOR);
  assert.deepEqual(q.blockers, []);
  assert.equal(q.basis.resolvedVerdicts, 250);
});

test("実測不足 → fail closed", () => {
  const q = underwrite({ ...base, resolvedVerdicts: UNDERWRITE_MIN_RESOLVED - 1 });
  assert.equal(q.canOffer, false);
  assert.equal(q.maxCoverageUsd, 0);
  assert.equal(q.premiumRate, null);
  assert.match(q.blockers[0], /insufficient_resolved_verdicts/);
});

test("損失率が未公表(null) → fail closed（測れないリスクは値付けしない）", () => {
  const q = underwrite({ ...base, allowAdverseRate: null });
  assert.equal(q.canOffer, false);
  assert.ok(q.blockers.includes("allow_adverse_rate_unavailable"));
});

test("損失率が閾値超過 → fail closed", () => {
  const q = underwrite({ ...base, allowAdverseRate: 0.05 });
  assert.equal(q.canOffer, false);
  assert.match(q.blockers[0], /allow_adverse_rate_too_high/);
});

test("複数の欠格事由は全て列挙される（1つ目で打ち切らない）", () => {
  const q = underwrite({ ...base, resolvedVerdicts: 5, allowAdverseRate: null });
  assert.equal(q.blockers.length, 2);
});

test("上限はMAX_CAP_USDで頭打ち", () => {
  const q = underwrite({ ...base, resolvedVerdicts: 999999 });
  assert.equal(q.maxCoverageUsd, MAX_CAP_USD);
});

test("保険料 = 損失率×安全倍率（フロア超の場合）", () => {
  const q = underwrite({ ...base, allowAdverseRate: 0.015 });
  assert.equal(q.canOffer, true);
  assert.ok(Math.abs((q.premiumRate ?? 0) - 0.075) < 1e-9);
});
