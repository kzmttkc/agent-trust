// 集中度集計（次波③）——述語が定義どおり数えることをDBで固定。名指しは出ない。
import { test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("concentration (skipped)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  test("concentration aggregates", async () => {
    const { computeConcentration } = await import("@/lib/observatory/concentration");
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const db = getDb()!;
    await db.execute(sql`TRUNCATE x402_endpoints, x402_l1_purchases`);
    const A = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";
    const B = "0x1111111111111111111111111111111111111111";
    const mk = (key: string, payTo: string) =>
      db.insert(schema.x402Endpoints).values({ resourceKey: key, resourceUrl: `https://${key}`, method: "GET", payTo }).returning();
    const [e1] = await mk("h1.example/a", A);
    await mk("h1.example/b", B);       // h1 は2payTo
    await mk("h2.example/x", A);       // A は2ホスト
    // Aのエンドポイントで2回失敗・0決済 → repeat_fail 1
    for (const t of [1, 2]) {
      await db.insert(schema.x402L1Purchases).values({ endpointId: e1.id, status: "settle_failed", spentUnits: "1000", attemptedAt: new Date(Date.now() - t * 3600_000) });
    }
    const c = (await computeConcentration())!;
    assert.equal(c.activeHosts, 2);
    assert.equal(c.distinctPayTos, 2);
    assert.equal(c.hostsWithMultiplePayTos, 1);
    assert.equal(c.maxPayTosOnOneHost, 2);
    assert.equal(c.payTosOnMultipleHosts, 1);
    assert.equal(c.maxHostsForOnePayTo, 2);
    assert.equal(c.repeatFailNoSuccessPayTos, 1);
    const json = JSON.stringify(c);
    assert.ok(!json.includes(A) && !json.includes(B), "個別アドレスは出力に現れない");
  });
}
