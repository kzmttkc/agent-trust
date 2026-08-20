// ============================================================
// 紛争フロー（C8）。固定する性質:
//  - payTo保持者だけが申し立てられる（他人の署名は not_payto_signer）
//  - 署名は実検証・改竄は invalid_signature
//  - 受理と同時に本物のL0再測定が1行、trigger=dispute 付きで記帳される
//  - 申し立てで既存記録は消えない（プローブ行が増えるだけ）
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("disputes (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  test("dispute flow", async (t) => {
    const { submitDispute, disputeMessage } = await import("@/lib/observatory/disputes");
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const db = getDb()!;
    await db.execute(sql`TRUNCATE x402_endpoints, x402_l0_probes, disputes`);

    const OWNER = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    const STRANGER = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const [ep] = await db
      .insert(schema.x402Endpoints)
      .values({
        resourceKey: "s.example/api",
        resourceUrl: "https://s.example/api",
        network: "eip155:8453",
        method: "GET",
        payTo: OWNER.address.toLowerCase(),
        priceAmount: "3000",
      })
      .returning();

    const challenge = () =>
      new Response(
        JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "3000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: OWNER.address }] }),
        { status: 402, headers: { "content-type": "application/json" } },
      );

    await t.test("payTo保持者の署名で受理・再測定が trigger=dispute で記帳される", async () => {
      const base = { endpointId: ep.id, subject: "l0", reason: "Your probe hit our maintenance window." };
      const signature = await OWNER.signMessage({ message: disputeMessage(base) });
      const result = await submitDispute(
        { ...base, address: OWNER.address, signature },
        { fetchImpl: async () => challenge() },
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.remeasureVerdict, "pass");
      const probes = await db.select().from(schema.x402L0Probes);
      assert.equal(probes.length, 1);
      assert.equal((probes[0].rawResponseMeta as { trigger?: string }).trigger, "dispute");
      const [d] = await db.select().from(schema.disputes);
      assert.equal(d.status, "remeasured");
    });

    await t.test("payTo以外の署名者は not_payto_signer", async () => {
      const base = { endpointId: ep.id, subject: "l0", reason: "not mine though" };
      const signature = await STRANGER.signMessage({ message: disputeMessage(base) });
      const result = await submitDispute(
        { ...base, address: STRANGER.address, signature },
        { fetchImpl: async () => challenge() },
      );
      assert.deepEqual(result, { ok: false, reason: "not_payto_signer" });
    });

    await t.test("本文を変えた署名は invalid_signature", async () => {
      const base = { endpointId: ep.id, subject: "l0", reason: "original reason" };
      const signature = await OWNER.signMessage({ message: disputeMessage(base) });
      const result = await submitDispute(
        { ...base, reason: "tampered reason", address: OWNER.address, signature },
        { fetchImpl: async () => challenge() },
      );
      assert.deepEqual(result, { ok: false, reason: "invalid_signature" });
    });
  });
}
