// ============================================================
// 検証リクエストキュー v0（C9）。固定する性質:
//  - カタログ実在エンドポイントのみ受理・pending は1件に畳む（dedup）
//  - drain は古い順に実プローブし trigger=request で記帳・probed へ落とす
//  - 消えたエンドポイントの行は invalid（黙って捨てない）
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("requests (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  test("verification request queue", async (t) => {
    const { enqueueVerificationRequest, drainVerificationRequests } = await import(
      "@/lib/observatory/requests"
    );
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const db = getDb()!;
    await db.execute(sql`TRUNCATE x402_endpoints, x402_l0_probes, verification_requests`);

    const [ep] = await db
      .insert(schema.x402Endpoints)
      .values({ resourceKey: "q.example/api", resourceUrl: "https://q.example/api", network: "eip155:8453", method: "GET", priceAmount: "3000", priceAsset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea" })
      .returning();

    await t.test("受理とdedup", async () => {
      const a = await enqueueVerificationRequest({ endpointId: ep.id, requesterIp: "1.2.3.4" });
      const b = await enqueueVerificationRequest({ endpointId: ep.id, requesterIp: "5.6.7.8" });
      assert.equal(a.ok && !a.deduped, true);
      assert.equal(b.ok && b.deduped, true);
      const miss = await enqueueVerificationRequest({
        endpointId: "00000000-0000-4000-8000-000000000000",
        requesterIp: null,
      });
      assert.deepEqual(miss, { ok: false, reason: "endpoint_not_found" });
    });

    await t.test("drainで実プローブ・trigger=request記帳・probedへ", async () => {
      const summary = await drainVerificationRequests(10, {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "3000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea" }] }),
            { status: 402, headers: { "content-type": "application/json" } },
          ),
      });
      assert.deepEqual(summary, { drained: 1, probed: 1, invalid: 0, deferred: 0 });
      const probes = await db.select().from(schema.x402L0Probes);
      assert.equal(probes.length, 1);
      assert.equal((probes[0].rawResponseMeta as { trigger?: string }).trigger, "request");
      const reqs = await db.select().from(schema.verificationRequests);
      assert.equal(reqs[0].status, "probed");
    });
  });
}
