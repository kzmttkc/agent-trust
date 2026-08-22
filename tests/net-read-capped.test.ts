// ============================================================
// 上限つき本文読み取り（2026-08-22 監査・項目7）。
//
// 守りたい性質:「敵対エンドポイントの巨大ボディでサーバレス関数のメモリを
// 食えない」。`(await res.text()).slice(0, N)` は全部受け取ってから切るので
// 上限が何も守っていなかった——だからこのテストは**返り値の長さ**だけでなく
// 「相手からどれだけ引いたか」まで測る（測定器の検証）。
// Run: npx tsx --test tests/net-read-capped.test.ts
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyCapped } from "@/lib/net/read-capped";

/** 1KB のチャンクを無限に出し続けるボディ。cancel されるまで止まらない。 */
function endlessBody(chunkSize = 1_024) {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls++;
      if (state.pulls > 10_000) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize).fill(0x61)); // "a"
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

test("巨大なボディは上限バイトで打ち切られ、残りは引かない", async () => {
  const { stream, state } = endlessBody();
  const body = await readBodyCapped(new Response(stream), 5_000);

  assert.equal(body.length, 5_000, "上限ちょうどで返る");
  assert.equal(body, "a".repeat(5_000));
  // 上限 5,000B をチャンク 1KB で満たすのに必要なのは 5 回。多少の先読みは
  // 許すが、10,000 チャンクを飲み込んでいないことを固定する。
  // 実測（node v26 / undici, 2026-08-22）: pulls=5（5,000B を 1KB チャンクで
  // 満たすのに必要な回数そのもの）。上限に余裕を持たせても、10,000チャンクを
  // 飲み込む旧実装とは決定的に違う。
  assert.ok(state.pulls <= 16, `読みすぎ: pulls=${state.pulls}`);
  assert.equal(state.cancelled, true, "上限に達したらストリームを cancel する");
});

test("上限より小さい本文はそのまま返る（既存の呼び出しと互換）", async () => {
  const payload = JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact" }] });
  const body = await readBodyCapped(new Response(payload), 16_000);
  assert.equal(body, payload);
  assert.deepEqual(JSON.parse(body).accepts.length, 1);
});

test("マルチバイトも壊さずに読む（上限内）", async () => {
  const payload = JSON.stringify({ note: "壁は402を返した" });
  assert.ok(Buffer.byteLength(payload) > payload.length, "テスト前提: マルチバイト");
  assert.equal(await readBodyCapped(new Response(payload), 16_000), payload);
});

test("body を持たない Response（テストのモック等）は text() にフォールバックする", async () => {
  let textCalls = 0;
  const fake = {
    body: null,
    text: async () => {
      textCalls++;
      return "x".repeat(100);
    },
  } as unknown as Response;
  assert.equal(await readBodyCapped(fake, 10), "x".repeat(10));
  assert.equal(textCalls, 1);
});

test("上限 0 は空文字（本文を読みに行かない）", async () => {
  const { stream, state } = endlessBody();
  assert.equal(await readBodyCapped(new Response(stream), 0), "");
  // Response の構築自体が1チャンク先読みすることがある（undici 実測）。
  // 固定したいのは「読み取りループに入っていない」ことなので上限は1。
  assert.ok(state.pulls <= 1, `読みに行っている: pulls=${state.pulls}`);
});

test("読み取り中のエラーは呼び手へ伝わる（黙って空文字にしない）", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("connection reset"));
    },
  });
  await assert.rejects(() => readBodyCapped(new Response(stream), 1_000));
});
