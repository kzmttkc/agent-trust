// ============================================================
// payToグラフ v0（A7）。隣接の事実が定義どおり返ることをDBで固定。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("payto graph (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  test("payto graph adjacency", async () => {
    const { computePayToGraph } = await import("@/lib/scoring/graph");
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const db = getDb()!;
    await db.execute(sql`TRUNCATE x402_endpoints, x402_l1_purchases`);

    const A = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";
    const B = "0x1111111111111111111111111111111111111111";
    const mk = (key: string, payTo: string) =>
      db.insert(schema.x402Endpoints).values({ resourceKey: key, resourceUrl: `https://${key}`, network: "eip155:8453", method: "GET", payTo }).returning();
    const [e1] = await mk("host1.example/a", A);
    await mk("host1.example/b", B); // 同ホスト別payTo
    await mk("host2.example/x", A);
    await db.insert(schema.x402L1Purchases).values({ endpointId: e1.id, status: "settled", spentUnits: "3000", attemptedAt: new Date() });

    const g = await computePayToGraph(A);
    assert.ok(g);
    assert.equal(g!.operates.length, 2);
    const op1 = g!.operates.find((o) => o.resourceKey === "host1.example/a")!;
    assert.equal(op1.attempts, 1);
    assert.equal(op1.settled, 1);
    assert.deepEqual(g!.sharesHostWith, [{ host: "host1.example", payTo: B, endpoints: 1 }]);
  });
}
