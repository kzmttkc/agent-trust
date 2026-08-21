// ============================================================
// ERC-8004 Validation Registry 書込の dry-run 見積もり（2026-08-21・WO#5）。
// 金（ガス）に直結する数字を出す計算なので、純粋関数として固定する:
//  - 候補の判定は registry-hook の分岐と同じ（hookが呼ばれる終局3状態・EVM payTo のみ）
//  - 重複 requestHash は「初出の日」にだけ数える（台帳の一意制約＝冪等ゲートの写し）
//  - ガス単位は eth_estimateGas → 観測中央値 → 固定上限 の順で fail-closed に選ぶ
//  - 費用 = L2実行(gas×fee) + L1データ手数料（Base はOPスタック）。丸めない（wei整数）
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRegistryCandidates,
  classifyForRegistry,
  estimateWriteCostWei,
  formatWeiAsEth,
  medianBigint,
  recommendCaps,
  selectGasUnits,
  weiToUsd,
  wouldSkipForGasCap,
  type L1PurchaseRowLike,
} from "@/lib/chain/registry-dryrun";

const EVM = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";
const SOL = "GqSs5L9aPWGJwyRQe35YKQaWMDPh3R1dMqfSEPhSgkM";
const E1 = "5f0c9c5e-2c3a-4b1e-9a4d-8f6b2e1c7d0a";
const E2 = "6a1d0d6f-3d4b-4c2f-8b5e-9a7c3f2d8e1b";

function row(p: Omit<Partial<L1PurchaseRowLike>, "attemptedAt"> & { attemptedAt: string }): L1PurchaseRowLike {
  return {
    endpointId: p.endpointId ?? E1,
    status: p.status ?? "settled",
    payTo: p.payTo === undefined ? EVM : p.payTo,
    attemptedAt: new Date(p.attemptedAt),
  };
}

test("classify: hookが呼ばれる終局3状態のみ候補・settledだけが pass", () => {
  assert.deepEqual(classifyForRegistry(row({ attemptedAt: "2026-08-20T00:00:00Z", status: "settled" })), {
    kind: "candidate",
    verdict: "pass",
  });
  for (const status of ["settle_failed", "delivered_no_receipt"]) {
    assert.deepEqual(classifyForRegistry(row({ attemptedAt: "2026-08-20T00:00:00Z", status })), {
      kind: "candidate",
      verdict: "fail",
    });
  }
  for (const status of ["in_flight", "no_402", "budget_denied", "request_error", "over_cap", "price_mismatch", "no_eligible_accept"]) {
    assert.deepEqual(classifyForRegistry(row({ attemptedAt: "2026-08-20T00:00:00Z", status })), {
      kind: "not_hook_outcome",
    });
  }
});

test("classify: Solana/null/不正 payTo は not_evm（hookの not_evm と同じ）", () => {
  assert.deepEqual(classifyForRegistry(row({ attemptedAt: "2026-08-20T00:00:00Z", payTo: SOL })), { kind: "not_evm" });
  assert.deepEqual(classifyForRegistry(row({ attemptedAt: "2026-08-20T00:00:00Z", payTo: null })), { kind: "not_evm" });
  assert.deepEqual(classifyForRegistry(row({ attemptedAt: "2026-08-20T00:00:00Z", payTo: "0x1234" })), { kind: "not_evm" });
});

test("aggregate: 日次件数・重複hashは初出日にだけ数える・窓外の初出は窓内で重複扱い", () => {
  const rows: L1PurchaseRowLike[] = [
    // 窓の前（8/10）に E1/pass が初出 → 窓内の E1/pass は全部 duplicate
    row({ endpointId: E1, attemptedAt: "2026-08-10T12:00:00Z", status: "settled" }),
    // 8/15: E1 pass ×2（重複）, E1 fail（初出）, E2 pass（初出）, Solana（not_evm）, in_flight（対象外）
    row({ endpointId: E1, attemptedAt: "2026-08-15T01:00:00Z", status: "settled" }),
    row({ endpointId: E1, attemptedAt: "2026-08-15T02:00:00Z", status: "settled" }),
    row({ endpointId: E1, attemptedAt: "2026-08-15T03:00:00Z", status: "settle_failed" }),
    row({ endpointId: E2, attemptedAt: "2026-08-15T04:00:00Z", status: "settled" }),
    row({ endpointId: E2, attemptedAt: "2026-08-15T05:00:00Z", status: "settled", payTo: SOL }),
    row({ endpointId: E2, attemptedAt: "2026-08-15T06:00:00Z", status: "in_flight" }),
    // 8/16: E2 pass（重複）, E2 fail（初出・delivered_no_receipt）
    row({ endpointId: E2, attemptedAt: "2026-08-16T23:59:59Z", status: "settled" }),
    row({ endpointId: E2, attemptedAt: "2026-08-16T10:00:00Z", status: "delivered_no_receipt" }),
  ];
  const out = aggregateRegistryCandidates(rows, {
    windowStart: new Date("2026-08-14T00:00:00Z"),
    windowEnd: new Date("2026-08-21T00:00:00Z"),
  });
  assert.equal(out.window.days, 7);
  assert.equal(out.in_window.rows_total, 8);
  assert.equal(out.in_window.not_hook_outcome, 1);
  assert.equal(out.in_window.not_evm, 1);
  assert.equal(out.in_window.hook_calls, 6);
  assert.equal(out.in_window.unique_new_writes, 3, "E1/fail, E2/pass, E2/fail");
  assert.equal(out.in_window.duplicate_skipped, 3);
  // 日別（7日ぶん・0の日も出す）
  assert.equal(out.days.length, 7);
  assert.deepEqual(out.days.map((d) => d.day), [
    "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
  ]);
  const d15 = out.days.find((d) => d.day === "2026-08-15")!;
  assert.deepEqual(
    { hook_calls: d15.hook_calls, unique_new_writes: d15.unique_new_writes, pass: d15.unique_new_pass, fail: d15.unique_new_fail },
    { hook_calls: 4, unique_new_writes: 2, pass: 1, fail: 1 },
  );
  const d16 = out.days.find((d) => d.day === "2026-08-16")!;
  assert.deepEqual({ hook_calls: d16.hook_calls, unique_new_writes: d16.unique_new_writes }, { hook_calls: 2, unique_new_writes: 1 });
  const d14 = out.days.find((d) => d.day === "2026-08-14")!;
  assert.deepEqual({ hook_calls: d14.hook_calls, unique_new_writes: d14.unique_new_writes }, { hook_calls: 0, unique_new_writes: 0 });
  assert.equal(out.in_window.max_unique_new_writes_per_day, 2);
  // 「全期間で初出」の前提: 台帳が空（registry_writes 0行）の時だけ正しいので明示する
  assert.equal(out.assumptions.dedupe_basis, "first_seen_all_time_over_supplied_rows");
});

test("aggregate: 索引済みagentウォレット集合を渡すと、解決見込みの部分集合を別に数える", () => {
  const rows = [
    row({ endpointId: E1, attemptedAt: "2026-08-15T01:00:00Z", status: "settled", payTo: EVM }),
    row({ endpointId: E2, attemptedAt: "2026-08-15T01:00:00Z", status: "settled", payTo: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
  ];
  const out = aggregateRegistryCandidates(rows, {
    windowStart: new Date("2026-08-14T00:00:00Z"),
    windowEnd: new Date("2026-08-21T00:00:00Z"),
    indexedAgentWallets: new Set([EVM.toUpperCase()]), // 大文字小文字は無視
  });
  assert.equal(out.in_window.unique_new_writes, 2);
  assert.equal(out.in_window.unique_new_writes_with_indexed_agent, 1);
  assert.equal(out.days.find((d) => d.day === "2026-08-15")!.unique_new_writes_with_indexed_agent, 1);
});

test("selectGasUnits: estimate → 観測中央値 → 固定 の順・失敗は黙らず source に残す", () => {
  assert.deepEqual(selectGasUnits({ estimated: 120_000n, observedMedian: 130_000n, fixed: 400_000n }), {
    units: 120_000n,
    source: "eth_estimateGas",
  });
  assert.deepEqual(selectGasUnits({ estimated: null, observedMedian: 130_000n, fixed: 400_000n }), {
    units: 130_000n,
    source: "observed_onchain_median",
  });
  assert.deepEqual(selectGasUnits({ estimated: null, observedMedian: null, fixed: 400_000n }), {
    units: 400_000n,
    source: "fixed_fallback",
  });
  // 0 や負は「取れなかった」扱い
  assert.equal(selectGasUnits({ estimated: 0n, observedMedian: null, fixed: 1n }).source, "fixed_fallback");
});

test("medianBigint: 偶数個は中央2つの平均（切り捨て）・空は null", () => {
  assert.equal(medianBigint([]), null);
  assert.equal(medianBigint([5n]), 5n);
  assert.equal(medianBigint([3n, 1n, 2n]), 2n);
  assert.equal(medianBigint([1n, 2n, 3n, 10n]), 2n);
});

test("estimateWriteCostWei: 2tx（request+response）の L2実行 + L1データ を wei 整数で合算", () => {
  const out = estimateWriteCostWei({
    requestGas: 378_937n,
    responseGas: 134_790n,
    feePerGasWei: 5_000_000n, // 0.005 gwei
    requestL1FeeWei: 1_000n,
    responseL1FeeWei: 2_000n,
  });
  assert.equal(out.l2_execution_wei, (378_937n + 134_790n) * 5_000_000n);
  assert.equal(out.l1_data_wei, 3_000n);
  assert.equal(out.total_wei, (378_937n + 134_790n) * 5_000_000n + 3_000n);
  assert.equal(out.gas_units_total, 513_727n);
});

test("wouldSkipForGasCap: registry.ts のサーキットブレーカと同じ境界（cap超過で退く・等しければ書く）", () => {
  // 既定 0.5 gwei
  assert.equal(wouldSkipForGasCap(500_000_000n, undefined), false);
  assert.equal(wouldSkipForGasCap(500_000_001n, undefined), true);
  assert.equal(wouldSkipForGasCap(2_000_000_000n, "3"), false);
  assert.equal(wouldSkipForGasCap(2_000_000_000n, "1.5"), true);
});

test("formatWeiAsEth / weiToUsd: 丸めない（ETHは18桁の厳密10進・USDは出所必須）", () => {
  assert.equal(formatWeiAsEth(0n), "0.000000000000000000");
  assert.equal(formatWeiAsEth(1n), "0.000000000000000001");
  assert.equal(formatWeiAsEth(1_500_000_000_000_000_000n), "1.500000000000000000");
  assert.equal(weiToUsd(1_000_000_000_000_000_000n, 3000), 3000);
  assert.equal(weiToUsd(500_000_000_000_000_000n, 3000.5), 1500.25);
  assert.equal(weiToUsd(1n, null), null);
});

test("recommendCaps: 最大日次件数×1件費用で日次/7日/30日の上限を wei のまま出す（丸めない）", () => {
  const out = recommendCaps({
    maxUniqueNewWritesPerDay: 3,
    perWriteAtCapWei: 1_234_567n,
    perWriteNowWei: 1_000n,
    capGwei: 0.5,
  });
  assert.equal(out.max_fee_gwei_cap_recommended, 0.5);
  assert.equal(out.daily_writes_cap_recommended, 3);
  assert.equal(out.daily_gas_budget_wei_at_cap, 3_703_701n);
  assert.equal(out.weekly_gas_budget_wei_at_cap, 25_925_907n);
  assert.equal(out.monthly_30d_gas_budget_wei_at_cap, 111_111_030n);
  assert.equal(out.daily_gas_budget_wei_at_current_fee, 3_000n);
  // 件数0なら予算0（「書くものが無いのに上限を設ける」を作らない）
  assert.equal(
    recommendCaps({ maxUniqueNewWritesPerDay: 0, perWriteAtCapWei: 1n, perWriteNowWei: 1n, capGwei: 0.5 })
      .daily_gas_budget_wei_at_cap,
    0n,
  );
});
