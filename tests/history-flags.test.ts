// ============================================================
// 履歴フラグ v0（A6）。述語が定義どおり発火することをDBで固定する。
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("history flags (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  test("history flags predicates", async () => {
    const { computeHistoryFlags } = await import("@/lib/scoring/history-flags");
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const db = getDb()!;
    await db.execute(sql`TRUNCATE x402_endpoints, x402_l0_probes, x402_l1_purchases`);

    const WALLET = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";
    const [ep] = await db
      .insert(schema.x402Endpoints)
      .values({ resourceKey: "f.example/api", resourceUrl: "https://f.example/api", network: "eip155:8453", method: "GET", payTo: WALLET })
      .returning();
    // repeat settle failure, no success
    for (const at of ["2026-08-10T01:00:00Z", "2026-08-12T01:00:00Z"]) {
      await db.insert(schema.x402L1Purchases).values({ endpointId: ep.id, status: "settle_failed", spentUnits: "1000", attemptedAt: new Date(at) });
    }
    // flapping: pass→fail→pass→fail within 14d = 3 changes
    const now = Date.now();
    const verdicts = ["pass", "fail", "pass", "fail"];
    for (let i = 0; i < verdicts.length; i++) {
      await db.insert(schema.x402L0Probes).values({ endpointId: ep.id, method: "GET", verdict: verdicts[i], probedAt: new Date(now - (4 - i) * 86_400_000) });
    }

    const flags = await computeHistoryFlags(WALLET);
    assert.ok(flags);
    assert.equal(flags!.endpoints, 1);
    assert.equal(flags!.flags.repeatSettleFailureNoSuccess, true);
    assert.equal(flags!.flags.l0Flapping14d, true);
    assert.equal(flags!.flags.priceMismatchRecorded, false);
    assert.equal(flags!.flags.payToMismatchRecorded, false);
    assert.equal(flags!.counts.settleFailed, 2);

    const none = await computeHistoryFlags("0x0000000000000000000000000000000000000001");
    assert.equal(none!.endpoints, 0);
    assert.equal(none!.flags.repeatSettleFailureNoSuccess, false);
  });
}
