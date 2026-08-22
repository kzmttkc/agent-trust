// ============================================================
// vet402 Observatory L1 — バッチ全体のデッドライン（2026-08-22 監査）。
//
// 守りたい性質は1つ:「**署名済み・予約済みの購入が、記帳される前に
// maxDuration で殺されない**」。runL1Batch は limit=100 を逐次処理するので、
// 1件ずつのタイムアウトだけでは全体を縛れない（20s × 100件 = 2000s）。
// ここでは判定を担う純関数と、予算とルートの maxDuration の関係を固定する。
// Run: npx tsx --test tests/observatory-l1-deadline.test.ts
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  L1_BATCH_BUDGET_MS,
  L1_PURCHASE_SLACK_MS,
  canStartAnotherPurchase,
  worstCasePurchaseMs,
} from "@/lib/observatory/l1-runner";

test("1件の最悪ケース = HTTP2本 + 署名/DB/RPC の余裕", () => {
  assert.equal(worstCasePurchaseMs(20_000), 20_000 * 2 + L1_PURCHASE_SLACK_MS);
  assert.equal(worstCasePurchaseMs(0), L1_PURCHASE_SLACK_MS);
});

test("残り時間が1件の最悪ケースを下回ったら新しい購入を始めない", () => {
  const worst = worstCasePurchaseMs(20_000);
  assert.equal(canStartAnotherPurchase(worst, 20_000), true);
  assert.equal(canStartAnotherPurchase(worst - 1, 20_000), false);
  assert.equal(canStartAnotherPurchase(0, 20_000), false);
  // 無制限（createDeadline(undefined) の remaining）は常に開始可。
  assert.equal(canStartAnotherPurchase(Infinity, 20_000), true);
});

test("予算 + 1件の最悪ケース は cron ルートの maxDuration の内側", () => {
  // ルート宣言を実ファイルから読む——定数を片方だけ動かしたら落ちる。
  const route = readFileSync(join(process.cwd(), "src/app/api/cron/l1-purchase/route.ts"), "utf8");
  const declared = /export const maxDuration = (\d+)/.exec(route);
  assert.ok(declared, "maxDuration の宣言が読み取れない");
  const maxDurationMs = Number(declared[1]) * 1_000;
  assert.ok(
    L1_BATCH_BUDGET_MS + worstCasePurchaseMs(20_000) <= maxDurationMs,
    `budget(${L1_BATCH_BUDGET_MS}) + worst(${worstCasePurchaseMs(20_000)}) > maxDuration(${maxDurationMs})`,
  );
});
