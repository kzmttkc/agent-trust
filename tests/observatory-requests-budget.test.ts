// ============================================================
// 公開検証リクエストキューのドレインは、日次L0測定を止められない。
//
// WHY (2026-08-22 監査). キューは APIキー不要・5回/分で誰でも積める。
// ドレインは選んだ行を逐次でプローブしていたので、1件10sのタイムアウト
// × 50件 = 最悪500s。呼び出し元 cron の maxDuration は 300s なので、
// 「キューに積むだけで日次測定を落とせる」経路だった。
//
// ここで固定するのは3つ:
//   - 時間予算を超えた行には着手しない（急かした測定を台帳へ書かない）
//   - 着手しなかった行は pending のまま残り、件数が summary に出る
//   - 予算内なら従来どおり全件プローブされる
//
// DB は本物を要らない（TEST_DATABASE_URL 不要）——ドレインの制御構造だけを見る。
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setDbForTests } from "@/lib/db/client";
import { drainVerificationRequests } from "@/lib/observatory/requests";

const ACCEPT = {
  scheme: "exact",
  amount: "3000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  payTo: "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea",
};

function pendingRow(n: number) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    endpoint_id: `10000000-0000-4000-8000-00000000000${n}`,
    resource_url: `https://svc${n}.example/api`,
    method: "GET",
    pay_to: ACCEPT.payTo,
    network: ACCEPT.network,
    price_amount: ACCEPT.amount,
    price_asset: ACCEPT.asset,
    missing: false,
  };
}

/** execute → pending 行、update/insert は呼ばれた事実だけ記録する最小フェイク。 */
function fakeDb(rows: unknown[]) {
  const updates: unknown[] = [];
  const inserts: unknown[] = [];
  const db = {
    async execute() {
      return rows;
    },
    update() {
      return {
        set(value: unknown) {
          updates.push(value);
          return { where: async () => [] };
        },
      };
    },
    insert() {
      return {
        values(value: unknown) {
          inserts.push(value);
          return Promise.resolve([]);
        },
      };
    },
  };
  return { db, updates, inserts };
}

/** 402 の壁を返すだけの売り手。`delayMs` で遅い売り手を演じる。 */
function seller(delayMs = 0) {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify({ x402Version: 2, accepts: [ACCEPT] }), {
      status: 402,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls: () => calls };
}

afterEach(() => __setDbForTests(null));

test("予算内なら全件プローブされ、deferred は 0", async () => {
  const rows = [pendingRow(1), pendingRow(2), pendingRow(3)];
  const { db, inserts } = fakeDb(rows);
  __setDbForTests(db);
  const s = seller();

  const summary = await drainVerificationRequests(10, {
    fetchImpl: s.fetchImpl,
    budgetMs: 5_000,
    timeoutMs: 200,
  });

  assert.deepEqual(summary, { drained: 3, probed: 3, invalid: 0, deferred: 0 });
  assert.equal(s.calls(), 3);
  assert.equal(inserts.length, 3);
});

test("予算を使い切った行には着手しない——残りは deferred として数えられ、pending のまま", async () => {
  const rows = Array.from({ length: 6 }, (_, i) => pendingRow(i));
  const { db, inserts } = fakeDb(rows);
  __setDbForTests(db);
  // 1件120ms、予算200ms、並列1。1本ぶん(120ms)の残りが無くなった時点で打ち切り。
  const s = seller(120);

  const summary = await drainVerificationRequests(10, {
    fetchImpl: s.fetchImpl,
    budgetMs: 200,
    timeoutMs: 120,
    concurrency: 1,
  });

  assert.equal(summary.drained, 6);
  assert.ok(summary.deferred > 0, "予算切れの行が deferred に出ること");
  assert.equal(summary.probed + summary.deferred, 6);
  // 着手しなかった行は台帳に何も書かない = 記録は probed 件数と一致する。
  assert.equal(inserts.length, summary.probed);
  assert.equal(s.calls(), summary.probed);
});

test("予算が1本ぶんに満たなければ1件も撃たない（急かした測定を売り手のfailにしない）", async () => {
  const rows = [pendingRow(1), pendingRow(2)];
  const { db, inserts } = fakeDb(rows);
  __setDbForTests(db);
  const s = seller();

  const summary = await drainVerificationRequests(10, {
    fetchImpl: s.fetchImpl,
    budgetMs: 0,
    timeoutMs: 10_000,
  });

  assert.deepEqual(summary, { drained: 2, probed: 0, invalid: 0, deferred: 2 });
  assert.equal(s.calls(), 0);
  assert.equal(inserts.length, 0);
});

test("消えたエンドポイントの行は予算に関係なく invalid へ落ちる（外向きHTTPが無いので）", async () => {
  const rows = [{ ...pendingRow(1), missing: true, resource_url: null }];
  const { db, updates } = fakeDb(rows);
  __setDbForTests(db);
  const s = seller();

  const summary = await drainVerificationRequests(10, {
    fetchImpl: s.fetchImpl,
    budgetMs: 0,
    timeoutMs: 10_000,
  });

  assert.deepEqual(summary, { drained: 1, probed: 0, invalid: 1, deferred: 0 });
  assert.deepEqual(updates, [{ status: "invalid" }]);
  assert.equal(s.calls(), 0);
});
