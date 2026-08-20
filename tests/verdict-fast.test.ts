// ============================================================
// verify-at-settle 高速面（C6）。契約:
//  - 絶対に計算しない: cold は cache_cold を正直に返す（fail-closedは呼び手）
//  - ハンドラ内レイテンシは1ms未満級（キャッシュ読みのみ）——p95をテストで固定
//  - 不正アドレスは400
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { __setDbForTests } from "@/lib/db/client";
import { GET } from "@/app/api/v1/payees/[address]/verdict-fast/route";

const ADDR = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";

function req(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${process.env.DEV_API_KEY}` },
  });
}

afterEach(() => {
  __setDbForTests(null);
  delete process.env.DEV_API_KEY;
});

test("cold: cache_cold を返し、warm先を案内・計算はしない", async () => {
  process.env.DEV_API_KEY = "dev_local_test_key";
  const res = await GET(req(`/api/v1/payees/${ADDR}/verdict-fast`), {
    params: Promise.resolve({ address: ADDR }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "cache_cold");
  assert.equal(body.recommendation, null);
  assert.match(body.warmVia, /\/score$/);
  assert.equal(typeof body.handlerMicros, "number");
});

test("p95: ハンドラ内処理は1ms未満（100回実測）", async () => {
  process.env.DEV_API_KEY = "dev_local_test_key";
  const micros: number[] = [];
  for (let i = 0; i < 100; i++) {
    const res = await GET(req(`/api/v1/payees/${ADDR}/verdict-fast`), {
      params: Promise.resolve({ address: ADDR }),
    });
    micros.push((await res.json()).handlerMicros as number);
  }
  micros.sort((a, b) => a - b);
  const p95 = micros[94];
  assert.ok(p95 < 1000, `p95 handler micros ${p95} must stay under 1000µs`);
});

test("不正アドレスは400", async () => {
  process.env.DEV_API_KEY = "dev_local_test_key";
  const res = await GET(req(`/api/v1/payees/nope/verdict-fast`), {
    params: Promise.resolve({ address: "nope" }),
  });
  assert.equal(res.status, 400);
});
