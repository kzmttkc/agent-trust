// ============================================================
// 2026-08-22 監査: レート制限の判定が実行環境で食い違っていた。
//
// DB経路（consumeDbIpRateLimit）は `row.count > limit` で判定するので
// limit=0 —— 「今日は1件も許さない」の意 —— を窓の1本目から拒否する。
// メモリ経路（consumeMemoryIpRateLimit）は「バケット無し」の高速路で
// limit を一切見ずに allowed:true を返していたため、1本だけすり抜けた。
//
// 実害の範囲は限定的だった（本番は DB 経路。DB不達時は isProduction() が
// fail-closed に落とす）。それでも直すのは、これが
// /api/v1/demo/verify のデモ専用日次サブ予算 —— 実資金の購入を起動する
// 経路の予算ガード —— に使われている関数だからで、
// **資金ガードの分岐が実行環境で変わってはいけない**。
//
// 発見経路: fix/netapi が書いた demo-verify の「サブ予算0なら429」テストが
// 200 を返して落ちた。テストが正しく、実装が間違っていた。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeIpRateLimit } from "@/lib/api/ip-rate-limit";

// DB が無く、かつ本番でない環境ではメモリ経路に落ちる（この経路を検査する）。
const uniq = () => `test-zero-budget-${process.pid}-${Math.random().toString(36).slice(2)}`;

test("limit=0 は窓の1本目も拒否する（DB経路と同じ判定）", async () => {
  const key = uniq();
  const first = await consumeIpRateLimit(key, 0, 60_000);
  assert.equal(first.allowed, false, "1本目が通ってはいけない");
  assert.equal(first.remaining, 0);
  assert.ok((first.retryAfter ?? 0) > 0, "拒否には Retry-After が要る");

  const second = await consumeIpRateLimit(key, 0, 60_000);
  assert.equal(second.allowed, false, "2本目も当然拒否");
});

test("limit=1 はちょうど1本だけ通す（境界の反対側を壊していないこと）", async () => {
  const key = uniq();
  assert.equal((await consumeIpRateLimit(key, 1, 60_000)).allowed, true);
  assert.equal((await consumeIpRateLimit(key, 1, 60_000)).allowed, false);
});

test("limit=5 はちょうど5本通す（既存の挙動が変わっていないこと）", async () => {
  const key = uniq();
  for (let i = 1; i <= 5; i++) {
    assert.equal((await consumeIpRateLimit(key, 5, 60_000)).allowed, true, `${i}本目は通るはず`);
  }
  assert.equal((await consumeIpRateLimit(key, 5, 60_000)).allowed, false, "6本目は拒否");
});
