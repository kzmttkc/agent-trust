// ============================================================
// observed_purchases.delivery_verified の書き手側判定（2026-08-22 監査・項目1）。
//
// この列は読み取り時に導出できない——reader（src/lib/db/observed-purchases.ts）
// は「観測所がそう書いた」ことを信じるだけで、scoreEconomicActivity は
// この1ビットの差で x402 相当（決済しただけ）と L1（品が届いた）を分ける。
// つまり判定を甘くすると、最上位軸(0.40)のプレミアム信号が安く買えるように
// なる。だから条件を DB 抜きでここに固定する。
// Run: npx tsx --test tests/observatory-l1-delivery-verified.test.ts
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeliveryVerified } from "@/lib/observatory/l1-runner";

test("200 + 本文あり + スキーマ不一致でない → 配送確認済み", () => {
  assert.equal(
    isDeliveryVerified({ httpStatusPaid: 200, payloadNonEmpty: true, l2Schema: "match" }),
    true,
  );
  // 宣言が無いのは減点しない（no_declaration は売り手の落ち度ではない）。
  assert.equal(
    isDeliveryVerified({ httpStatusPaid: 200, payloadNonEmpty: true, l2Schema: "no_declaration" }),
    true,
  );
});

test("決済しただけ・品が来ていない状態は配送確認にしない", () => {
  // 402/500 が返った（決済レシートはあるのに品が来ていない）。
  assert.equal(
    isDeliveryVerified({ httpStatusPaid: 500, payloadNonEmpty: true, l2Schema: "not_checked" }),
    false,
  );
  // 200 だが本文が空（タイムアウトで本文だけ落ちた場合もここ）。
  assert.equal(
    isDeliveryVerified({ httpStatusPaid: 200, payloadNonEmpty: false, l2Schema: "no_declaration" }),
    false,
  );
  // 宣言スキーマに反する応答＝配送の確認になっていない。
  assert.equal(
    isDeliveryVerified({ httpStatusPaid: 200, payloadNonEmpty: true, l2Schema: "mismatch" }),
    false,
  );
  // そもそも応答が無い（署名したが返ってこなかった）。
  assert.equal(
    isDeliveryVerified({ httpStatusPaid: null, payloadNonEmpty: false, l2Schema: "not_checked" }),
    false,
  );
});
