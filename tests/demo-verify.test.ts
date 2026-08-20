// ============================================================
// /playground の背後にあるデモ検証コア。ここで守るのは配線であって
// プローブの判定ロジックではない（それは observatory-probe.test.ts の仕事）:
//   - カタログ行が ProbeTarget へ正しく写像されること
//   - 見つからない/廃止済みの行では一切リクエストを送らないこと
//   - デモは公開台帳へ書かない（このモジュールには writer が無い——
//     import に書き込み系が現れないことを型レベルで担保）
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setDbForTests } from "@/lib/db/client";
import { runDemoL0 } from "@/lib/demo/verify";

const CATALOG_ACCEPT = {
  amount: "3000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  payTo: "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea",
};

const ENDPOINT_ID = "5f0c9c5e-2c3a-4b1e-9a4d-8f6b2e1c7d0a";

function endpointRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENDPOINT_ID,
    resourceKey: "svc.example/api",
    resourceUrl: "https://svc.example/api",
    method: "GET",
    payTo: CATALOG_ACCEPT.payTo,
    network: CATALOG_ACCEPT.network,
    priceAmount: CATALOG_ACCEPT.amount,
    priceAsset: CATALOG_ACCEPT.asset,
    status: "active",
    ...overrides,
  };
}

/** select().from().where().limit() が rows を返すだけの読み取り専用フェイク。 */
function dbWithRows(rows: unknown[]) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return { limit: async () => rows };
            },
          };
        },
      };
    },
  };
}

function challenge402() {
  return async () =>
    new Response(
      JSON.stringify({
        x402Version: 2,
        accepts: [{ scheme: "exact", ...CATALOG_ACCEPT }],
      }),
      { status: 402, headers: { "content-type": "application/json" } },
    );
}

afterEach(() => __setDbForTests(null));

test("カタログの active 行に対して L0 プローブが走り、結果と endpoint 情報が返る", async () => {
  __setDbForTests(dbWithRows([endpointRow()]));
  const result = await runDemoL0(ENDPOINT_ID, { fetchImpl: challenge402() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.endpoint.id, ENDPOINT_ID);
  assert.equal(result.endpoint.resourceKey, "svc.example/api");
  assert.equal(result.probe.httpStatus, 402);
  assert.equal(result.probe.has402Challenge, true);
  assert.equal(result.probe.verdict, "pass");
});

test("存在しない ID → endpoint_not_found・リクエストは送られない", async () => {
  __setDbForTests(dbWithRows([]));
  let called = 0;
  const result = await runDemoL0(ENDPOINT_ID, {
    fetchImpl: async () => {
      called++;
      return new Response("", { status: 402 });
    },
  });
  assert.deepEqual(result, { ok: false, reason: "endpoint_not_found" });
  assert.equal(called, 0);
});

test("UUID の形をしていない ID → DB へも行かず endpoint_not_found", async () => {
  // 注入し忘れ検出: DB フェイク未設定でも UUID 検査が先に落とすこと
  __setDbForTests(dbWithRows([endpointRow()]));
  const result = await runDemoL0("../../etc/passwd", { fetchImpl: challenge402() });
  assert.deepEqual(result, { ok: false, reason: "endpoint_not_found" });
});

test("delisted 行 → endpoint_inactive・リクエストは送られない", async () => {
  __setDbForTests(dbWithRows([endpointRow({ status: "delisted" })]));
  let called = 0;
  const result = await runDemoL0(ENDPOINT_ID, {
    fetchImpl: async () => {
      called++;
      return new Response("", { status: 402 });
    },
  });
  assert.deepEqual(result, { ok: false, reason: "endpoint_inactive" });
  assert.equal(called, 0);
});

test("DB 未設定 → db_unavailable（fail-closed・500 の素材）", async () => {
  const result = await runDemoL0(ENDPOINT_ID, { fetchImpl: challenge402() });
  assert.deepEqual(result, { ok: false, reason: "db_unavailable" });
});

test("ROUTE: level=l1 は DEMO_L1_ENABLED が無い限り 403——1日1回のレート消費より先に拒否", async () => {
  delete process.env.DEMO_L1_ENABLED;
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/v1/demo/verify/route");
  const req = new NextRequest("http://localhost/api/v1/demo/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpointId: ENDPOINT_ID, level: "l1" }),
  });
  const res = await POST(req);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "demo_l1_disabled");
});

test("ROUTE: 未知の level は 400", async () => {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/v1/demo/verify/route");
  const req = new NextRequest("http://localhost/api/v1/demo/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpointId: ENDPOINT_ID, level: "l9" }),
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
});
