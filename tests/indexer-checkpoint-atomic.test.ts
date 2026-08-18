// ============================================================
// vet402 — atomic dual-checkpoint write (audit residual, 2026-08-18).
//
// The feedback indexer PRUNES old rows and then advances two checkpoints: the
// scan cursor (FEEDBACK_INDEX_CHECKPOINT) and the retention floor
// (FEEDBACK_COVERAGE_CHECKPOINT). Written as two separate statements, a crash
// between the prune and the coverage write leaves coverage pointing BEFORE the
// pruned boundary — a reader then believes it covers a window whose rows were
// just deleted, and answers a confident undercount (the exact fail mode
// feedback-index.ts's own comments warn about).
//
// The fix is a single statement that advances BOTH checkpoints at once, so no
// crash can land between them. These tests pin that helper: both scopes move
// together, and each stays monotonic (a stale run cannot rewind either).
//
// DB-backed; skips without TEST_DATABASE_URL.
// ============================================================
import { after, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("indexer checkpoint atomicity (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  after(async () => {
    const { getDb } = await import("@/lib/db/client");
    const db = getDb() as unknown as { $client?: { end?: () => Promise<void> } } | null;
    await db?.$client?.end?.();
  });

  test("setIndexerCheckpoints advances both scopes in one statement, monotonically", async (t) => {
    const { getDb } = await import("@/lib/db/client");
    const { setIndexerCheckpoints, getIndexerCheckpoint } = await import("@/lib/db/owner-index");
    const { sql } = await import("drizzle-orm");

    const db = getDb()!;
    const A = "test:atomic:index";
    const B = "test:atomic:coverage";
    await db.execute(sql`DELETE FROM indexer_checkpoints WHERE scope IN (${A}, ${B})`);

    await t.test("first write creates both rows", async () => {
      await setIndexerCheckpoints([
        { scope: A, lastBlock: 100n, chainTipAtRun: 500n },
        { scope: B, lastBlock: 50n, chainTipAtRun: 500n },
      ]);
      assert.equal(await getIndexerCheckpoint(A), 100n);
      assert.equal(await getIndexerCheckpoint(B), 50n);
    });

    await t.test("a forward run advances both", async () => {
      await setIndexerCheckpoints([
        { scope: A, lastBlock: 200n, chainTipAtRun: 600n },
        { scope: B, lastBlock: 120n, chainTipAtRun: 600n },
      ]);
      assert.equal(await getIndexerCheckpoint(A), 200n);
      assert.equal(await getIndexerCheckpoint(B), 120n);
    });

    await t.test("a stale/out-of-order run cannot rewind EITHER scope", async () => {
      await setIndexerCheckpoints([
        { scope: A, lastBlock: 150n, chainTipAtRun: 400n },
        { scope: B, lastBlock: 90n, chainTipAtRun: 400n },
      ]);
      // GREATEST guard holds for both — neither moved backwards.
      assert.equal(await getIndexerCheckpoint(A), 200n);
      assert.equal(await getIndexerCheckpoint(B), 120n);
    });

    await t.test("a single-scope write still works (backward compatible)", async () => {
      await setIndexerCheckpoints([{ scope: A, lastBlock: 300n, chainTipAtRun: 700n }]);
      assert.equal(await getIndexerCheckpoint(A), 300n);
      assert.equal(await getIndexerCheckpoint(B), 120n, "the other scope is untouched");
    });

    await db.execute(sql`DELETE FROM indexer_checkpoints WHERE scope IN (${A}, ${B})`);
  });
}
