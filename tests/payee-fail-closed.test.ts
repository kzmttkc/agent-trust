// ============================================================
// Vouch — the payee engine must never report "we could not check" as ALLOW.
//
// Measured in production 2026-08-13 on /payee/0xd8dA…6045, one wallet, one
// afternoon, nothing about the wallet changing between reads:
//   first load  → 70 ALLOW   ("data: thin")
//   reload      → 37 BLOCK   (then stable for three more reloads)
//   leaderboard → 49 WARN    (2026-08-12 benchmark scan)
//
// Reproduced here exactly (see the four cases below): the entire spread is
// decided by WHICH upstream read happened to fail, not by anything on chain.
//   both reads OK        → 84 ALLOW
//   drain check down     → 70 ALLOW   ← 70 is exactly SCORE_THRESHOLDS.allow
//   wallet-metrics down  → 51 WARN
//   both down            → 37 BLOCK
//
// The 70 is the bug, and it is the fail-OPEN direction: scoreDrain() substitutes
// a neutral 50 for an outflow/exit-scam check that never ran, and
// scorePayeeWallet called toRecommendation() directly — bypassing the
// `*_unavailable` → high risk → BLOCK chain that verdict.ts documents as "the
// whole fail-closed design". So a wallet whose exit-scam check was never
// performed cleared the product's most permissive verdict, and the SDK's
// SpendGuard (packages/sdk/src/spend-guard.ts) would have sent real money on it.
//
// These tests pin the invariant on the buyer-side engine that
// tests/verdict-consistency.test.ts already pins on the seller-side one.
// ============================================================
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { SCORE_THRESHOLDS } from "@/lib/chain/config";
import { resetBlockscoutRateGate } from "@/lib/chain/blockscout";
import { invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { invalidatePayeeScoreCache, scorePayeeWallet } from "@/lib/scoring/payee-engine";
import { toRecommendation } from "@/lib/scoring/verdict";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
const realFetch = globalThis.fetch;

const okJson = (result: unknown) =>
  new Response(JSON.stringify({ status: "1", message: "OK", result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * A wallet that is unambiguously fine on every axis the engine reads: 200 days
 * old, 121 non-self transactions, paid in USDC and still holding most of it.
 * Chosen so the healthy verdict is a comfortable ALLOW — the point of each
 * case is what happens when a read is taken AWAY from that, never a borderline
 * wallet where the answer was arguable to begin with.
 */
const now = Math.floor(Date.now() / 1000);
const fundingTx = {
  hash: "0x1",
  from: "0x000000000000000000000000000000000000dead",
  to: WALLET.toLowerCase(),
  value: "1000000000000000",
  timeStamp: String(now - 200 * 86_400),
  blockNumber: "1",
  isError: "0",
};
const historyPage = [
  fundingTx,
  ...Array.from({ length: 120 }, (_, i) => ({
    hash: `0x${i + 2}`,
    from: WALLET.toLowerCase(),
    to: "0x000000000000000000000000000000000000beef",
    value: "0",
    timeStamp: String(now - (190 - i) * 86_400),
    blockNumber: String(i + 2),
    isError: "0",
  })),
];
const usdcTransfers = [
  {
    hash: "0xa",
    from: "0x000000000000000000000000000000000000cafe",
    to: WALLET.toLowerCase(),
    value: "5000000000", // received 5,000 USDC
    timeStamp: String(now - 30 * 86_400),
    blockNumber: "500",
  },
  {
    hash: "0xb",
    from: WALLET.toLowerCase(),
    to: "0x000000000000000000000000000000000000feed",
    value: "1000000000", // paid out 1,000 USDC — ratio 0.2, nowhere near a drain
    timeStamp: String(now - 10 * 86_400),
    blockNumber: "600",
  },
];

type Down = { metrics?: boolean; drain?: boolean };

/**
 * Stubs Blockscout at the fetch boundary, the same lever
 * tests/blockscout-resilience.test.ts uses. The two read groups are
 * distinguishable by their parameters: wallet-metrics walks history ASCENDING
 * plus the v2 counter endpoint; the drain check reads DESCENDING history,
 * token transfers and the two balances.
 */
function upstream(down: Down) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const params = new URL(url).searchParams;
    const action = params.get("action");
    const sort = params.get("sort");
    const dead = new Response("upstream is down", { status: 503 });

    if (url.includes("/v2/addresses/")) {
      if (down.metrics) return dead;
      return new Response(JSON.stringify({ transactions_count: 121 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (action === "txlist" && sort === "asc") {
      if (down.metrics) return dead;
      return okJson(params.get("page") === "1" ? historyPage : []);
    }
    if (action === "txlist" && sort === "desc") {
      if (down.drain) return dead;
      return okJson([...historyPage].reverse());
    }
    if (action === "tokentx") {
      if (down.drain) return dead;
      return okJson([...usdcTransfers].reverse());
    }
    if (action === "balance") {
      if (down.drain) return dead;
      return okJson("900000000000000");
    }
    if (action === "tokenbalance") {
      if (down.drain) return dead;
      return okJson("4000000000"); // 4,000 of the 5,000 USDC still there
    }
    throw new Error(`unstubbed upstream call: ${url}`);
  }) as typeof fetch;
}

function freshCaches() {
  invalidatePayeeScoreCache(WALLET);
  invalidateWalletMetricsCache(WALLET);
  resetBlockscoutRateGate();
}

async function score(down: Down) {
  upstream(down);
  freshCaches();
  return scorePayeeWallet(WALLET);
}

beforeEach(() => {
  process.env.BLOCKSCOUT_MIN_INTERVAL_MS = "0";
  process.env.BLOCKSCOUT_COOLDOWN_MS = "0";
  process.env.BLOCKSCOUT_API_URL = "https://base.blockscout.com/api";
  delete process.env.SKIP_CHAIN_READS;
  delete process.env.DATABASE_URL;
  freshCaches();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  freshCaches();
  delete process.env.BLOCKSCOUT_MIN_INTERVAL_MS;
  delete process.env.BLOCKSCOUT_COOLDOWN_MS;
});

test("a wallet we could fully read still gets a real verdict", async () => {
  const result = await score({});
  assert.equal(result.signals.flags.length, 0, "nothing should be unavailable here");
  assert.equal(result.degraded, false);
  assert.equal(result.recommendation, "ALLOW");
  assert.ok(result.score >= SCORE_THRESHOLDS.allow, `expected an ALLOW-grade score, got ${result.score}`);
});

test("FAIL-CLOSED: an outflow check that never ran must not clear ALLOW", async () => {
  // The exact production regression. Before the fix this returned 70 — the
  // ALLOW threshold to the point — with drain_check_unavailable sitting
  // unread in signals.flags.
  const result = await score({ drain: true });
  assert.ok(
    result.signals.flags.includes("drain_check_unavailable"),
    "the failed read must still be reported",
  );
  assert.equal(result.degraded, true);
  assert.notEqual(result.recommendation, "ALLOW");
  assert.equal(result.recommendation, "BLOCK");
});

test("FAIL-CLOSED: unreadable wallet metrics must not clear ALLOW or WARN", async () => {
  const result = await score({ metrics: true });
  assert.ok(result.signals.flags.includes("wallet_metrics_unavailable"));
  assert.equal(result.degraded, true);
  assert.equal(result.recommendation, "BLOCK");
});

test("FAIL-CLOSED: every degraded combination lands on BLOCK", async () => {
  for (const down of [{ drain: true }, { metrics: true }, { metrics: true, drain: true }]) {
    const result = await score(down);
    assert.equal(
      result.recommendation,
      "BLOCK",
      `${JSON.stringify(down)} produced ${result.recommendation} at score ${result.score}`,
    );
  }
});

test("a degraded score never reads as a measurement we could defend", async () => {
  // The number is shown next to the verdict on /payee/[address]. "70 BLOCK"
  // would be the same self-contradiction in a different place, so the score
  // itself must sit below the block line whenever the verdict is BLOCK.
  for (const down of [{ drain: true }, { metrics: true }, { metrics: true, drain: true }]) {
    const result = await score(down);
    assert.ok(
      result.score < SCORE_THRESHOLDS.warn,
      `${JSON.stringify(down)} kept score ${result.score} above the block line`,
    );
  }
});

test("score and recommendation can never disagree", async () => {
  for (const down of [{}, { drain: true }, { metrics: true }, { metrics: true, drain: true }]) {
    const result = await score(down);
    assert.equal(
      toRecommendation(result.score, false),
      result.recommendation,
      `${JSON.stringify(down)}: score ${result.score} does not band to ${result.recommendation}`,
    );
  }
});

test("unreadable wallet metrics are not reported as a burner wallet", async () => {
  // ageDays 0 / txCount 0 is what a failed read leaves behind, and
  // normalizeWalletScore reads that as `isBurner` — asserting a fact about the
  // wallet that nobody measured, on a site whose masthead is "Nothing on this
  // site is an estimate."
  const result = await score({ metrics: true });
  assert.equal(result.signals.walletHealth.isBurner, false);
  assert.ok(!result.signals.flags.includes("new_burner_wallet"));
});

test("DETERMINISM: the same wallet and the same upstream give the same verdict", async () => {
  for (const down of [{}, { drain: true }, { metrics: true }, { metrics: true, drain: true }]) {
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(await score(down));
    const first = runs[0]!;
    for (const run of runs) {
      assert.equal(run.score, first.score, `score flapped under ${JSON.stringify(down)}`);
      assert.equal(
        run.recommendation,
        first.recommendation,
        `verdict flapped under ${JSON.stringify(down)}`,
      );
      assert.equal(run.dataDepth, first.dataDepth);
    }
  }
});

test("a degraded verdict is never cached", async () => {
  // Same rule tests/verdict-consistency.test.ts pins on the seller-side engine:
  // a verdict the engine is not confident enough to cache is one nobody may pin.
  upstream({ drain: true });
  freshCaches();
  const degraded = await scorePayeeWallet(WALLET);
  assert.equal(degraded.degraded, true);

  // Upstream recovers. Without invalidating anything, the next call must
  // recompute rather than serve the cached BLOCK.
  upstream({});
  invalidateWalletMetricsCache(WALLET);
  resetBlockscoutRateGate();
  const recovered = await scorePayeeWallet(WALLET);
  assert.equal(recovered.degraded, false);
  assert.equal(recovered.recommendation, "ALLOW");
});
