// ============================================================
// vet402 Observatory L1 — priority-seller targeting (要件定義v2 2026-08-14 §2.1-2).
//
// The rikocr8orh8 survey (data 2026-07-28, methodology reproducible)
// identified by name the endpoints carrying 73% of ALL organic Bazaar calls:
// x402.twit.sh, x402.tavily.com, stableenrich.dev, api.exa.ai. The moat is
// the receipt TIME-SERIES, so the daily $25 belongs on repeated purchases of
// endpoints buyers actually depend on — not one-shot coverage of a 531-item
// long tail. Properties under test:
//
//  1. A priority seller outranks a higher-demand non-priority seller in
//     candidate selection (fixed head of the list).
//  2. Priority sellers re-enter the candidate pool after
//     PRIORITY_SWEEP_WINDOW_DAYS (repeat purchases build the series), while
//     non-priority sellers stay excluded for the full SWEEP_WINDOW_DAYS.
//
// DB-backed; skips without TEST_DATABASE_URL (same convention as the other
// observatory suites).
// ============================================================
import { after, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

if (!TEST_DB) {
  test("observatory l1 priority targeting (skipped: TEST_DATABASE_URL not set)", { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;

  const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const payToFor = (n: string | number) => `0x${String(n).repeat(40).slice(0, 40)}`;

  after(async () => {
    const { getDb } = await import("@/lib/db/client");
    const db = getDb() as unknown as { $client?: { end?: () => Promise<void> } } | null;
    await db?.$client?.end?.();
  });

  test("L1 priority-seller targeting", async (t) => {
    const { runL1Batch, PRIORITY_SELLER_HOSTS, PRIORITY_SWEEP_WINDOW_DAYS, SWEEP_WINDOW_DAYS } =
      await import("@/lib/observatory/l1-runner");
    const { syncCatalog } = await import("@/lib/observatory/catalog-sync");
    const { runL0ProbeBatch } = await import("@/lib/observatory/probe-runner");
    const { parseCatalogItem } = await import("@/lib/observatory/catalog-source");
    const { BASE_USDC } = await import("@/lib/observatory/x402-payer");
    const { getDb } = await import("@/lib/db/client");
    const schema = await import("@/lib/db/schema");
    const { sql, eq } = await import("drizzle-orm");

    const db = getDb()!;
    await db.execute(
      sql`TRUNCATE x402_endpoints, x402_catalog_snapshots, x402_l0_probes, x402_delisting_events, x402_payee_watchers, x402_l1_purchases`,
    );

    const savedEnabled = process.env.OBSERVATORY_L1_ENABLED;
    const savedKey = process.env.OBSERVATORY_WALLET_PRIVATE_KEY;
    t.after(() => {
      if (savedEnabled === undefined) delete process.env.OBSERVATORY_L1_ENABLED;
      else process.env.OBSERVATORY_L1_ENABLED = savedEnabled;
      if (savedKey === undefined) delete process.env.OBSERVATORY_WALLET_PRIVATE_KEY;
      else process.env.OBSERVATORY_WALLET_PRIVATE_KEY = savedKey;
    });
    process.env.OBSERVATORY_L1_ENABLED = "true";
    process.env.OBSERVATORY_WALLET_PRIVATE_KEY = TEST_PK;

    // The survey-named sellers are the contract — a rename must fail loudly.
    await t.test("the priority list carries the four survey-verified hosts", () => {
      assert.deepEqual(
        [...PRIORITY_SELLER_HOSTS].sort(),
        ["api.exa.ai", "stableenrich.dev", "x402.tavily.com", "x402.twit.sh"].sort(),
      );
      assert.ok(
        PRIORITY_SWEEP_WINDOW_DAYS < SWEEP_WINDOW_DAYS,
        "priority window must be shorter — repeats are the point",
      );
    });

    // Seed: tavily (priority, LOW demand stats) vs a long-tail seller with
    // 100x the demand. Under demand-only ordering the tail seller wins; the
    // priority list must invert that.
    const items = [
      parseCatalogItem({
        resource: "https://x402.tavily.com/search",
        accepts: [{ amount: "3000", asset: BASE_USDC, network: "eip155:8453", payTo: payToFor(1) }],
        extensions: { bazaar: { info: { input: { method: "GET" } } } },
        quality: { l30DaysTotalCalls: 10, l30DaysUniquePayers: 2 },
      }),
      parseCatalogItem({
        resource: "https://seller9.example/api",
        accepts: [{ amount: "3000", asset: BASE_USDC, network: "eip155:8453", payTo: payToFor(9) }],
        extensions: { bazaar: { info: { input: { method: "GET" } } } },
        quality: { l30DaysTotalCalls: 1000, l30DaysUniquePayers: 100 },
      }),
    ];
    await syncCatalog({
      fetchResult: { items, totalCount: 2, fetchedCount: 2, complete: true },
      today: "2026-08-18",
    });

    const challengeFor = (url: string) => {
      const n = url.includes("tavily") ? "1" : "9";
      return JSON.stringify({
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            amount: "3000",
            asset: BASE_USDC,
            payTo: payToFor(n),
            maxTimeoutSeconds: 300,
            extra: { name: "USD Coin", version: "2" },
          },
        ],
      });
    };
    await runL0ProbeBatch({
      limit: 10,
      concurrency: 2,
      fetchImpl: async (url: string) =>
        new Response(challengeFor(url), { status: 402, headers: { "content-type": "application/json" } }),
    });

    const settleFetch = async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (headers.has("PAYMENT-SIGNATURE") || headers.has("X-PAYMENT")) {
        return new Response(JSON.stringify({ data: "the goods" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": Buffer.from(
              JSON.stringify({ success: true, transaction: "0xrepeat", network: "eip155:8453" }),
            ).toString("base64"),
          },
        });
      }
      return new Response(challengeFor(url), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    };

    await t.test("a priority seller outranks a 100x-demand long-tail seller", async () => {
      const seen: string[] = [];
      await runL1Batch({
        fetchImpl: async (url: string, init?: RequestInit) => {
          seen.push(url);
          return settleFetch(url, init);
        },
        limit: 1,
      });
      assert.ok(seen.length > 0, "a purchase must have been attempted");
      assert.ok(
        seen[0].includes("x402.tavily.com"),
        `priority seller must be first, got: ${seen[0]}`,
      );
    });

    await t.test(
      "a priority seller re-enters after its short window while the tail stays excluded",
      async () => {
        await db.execute(sql`TRUNCATE x402_l1_purchases`);

        // Both purchased 2 days ago: outside the priority window (1d), inside
        // the general window (6d).
        const rows = await db
          .select({ id: schema.x402Endpoints.id, resourceKey: schema.x402Endpoints.resourceKey })
          .from(schema.x402Endpoints);
        const tavily = rows.find((r) => r.resourceKey.includes("tavily"))!;
        const tail = rows.find((r) => r.resourceKey.includes("seller9"))!;
        const twoDaysAgo = sql`now() - interval '2 days'`;
        for (const ep of [tavily, tail]) {
          await db.execute(sql`
            INSERT INTO x402_l1_purchases (endpoint_id, status, amount_units, spent_units, attempted_at)
            VALUES (${ep.id}::uuid, 'settled', '3000', '3000', ${twoDaysAgo})
          `);
        }

        const seen: string[] = [];
        const summary = await runL1Batch({
          fetchImpl: async (url: string, init?: RequestInit) => {
            seen.push(url);
            return settleFetch(url, init);
          },
          limit: 10,
        });

        assert.equal(summary.attempted, 1, "exactly one endpoint is purchasable again");
        assert.ok(
          seen.every((u) => u.includes("x402.tavily.com")),
          `only the priority seller may repeat inside the general window, got: ${seen.join(", ")}`,
        );

        // The repeat actually landed on the ledger → the series grows.
        const tavilyRows = await db
          .select()
          .from(schema.x402L1Purchases)
          .where(eq(schema.x402L1Purchases.endpointId, tavily.id));
        assert.equal(tavilyRows.length, 2, "priority seller now has 2 records (series building)");
      },
    );
  });
}
