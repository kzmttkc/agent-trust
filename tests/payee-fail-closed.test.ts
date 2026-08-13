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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { SCORE_THRESHOLDS } from "@/lib/chain/config";
import { resetBlockscoutRateGate } from "@/lib/chain/blockscout";
import { invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { invalidatePayeeScoreCache, scorePayeeWallet } from "@/lib/scoring/payee-engine";
import { assessSybilRisk, hasUnavailableInput, toRecommendation } from "@/lib/scoring/verdict";

const readSrc = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

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
    // received 5,000 USDC
    transaction_hash: "0xa",
    from: { hash: "0x000000000000000000000000000000000000cafe" },
    to: { hash: WALLET.toLowerCase() },
    total: { value: "5000000000", decimals: "6" },
    timestamp: new Date((now - 30 * 86_400) * 1000).toISOString(),
    block_number: 500,
  },
  {
    // paid out 1,000 USDC — ratio 0.2, nowhere near a drain
    transaction_hash: "0xb",
    from: { hash: WALLET.toLowerCase() },
    to: { hash: "0x000000000000000000000000000000000000feed" },
    total: { value: "1000000000", decimals: "6" },
    timestamp: new Date((now - 10 * 86_400) * 1000).toISOString(),
    block_number: 600,
  },
];

const NATIVE_BALANCE = 900_000_000_000_000n; // 0.0009 ETH
const USDC_BALANCE = 4_000_000_000n; // 4,000 of the 5,000 USDC still there
const RPC_URL = "https://rpc.test.invalid";

const v2Native = historyPage.map((tx) => ({
  hash: tx.hash,
  block_number: Number(tx.blockNumber),
  timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
  value: tx.value,
  from: { hash: tx.from },
  to: { hash: tx.to },
}));

type Down = { metrics?: boolean; drain?: boolean };

/**
 * Stubs every upstream the payee engine reads, at the fetch boundary — the
 * same lever tests/blockscout-resilience.test.ts uses.
 *
 * The read groups are distinguishable by URL: wallet-metrics still walks
 * Blockscout v1 history ASCENDING (plus the v2 counter endpoint), while the
 * drain check — moved off v1 on 2026-08-13 — reads v2 transfer lists and gets
 * its two balances straight from the RPC.
 */
function upstream(down: Down) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const dead = new Response("upstream is down", { status: 503 });

    // --- RPC (balances) ---
    if (url.startsWith(RPC_URL)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as
        | { method?: string; id?: number }
        | { method?: string; id?: number }[];
      const calls = Array.isArray(body) ? body : [body];
      const reply = calls.map((call) => ({
        jsonrpc: "2.0",
        id: call.id ?? 1,
        result:
          call.method === "eth_getBalance"
            ? `0x${NATIVE_BALANCE.toString(16)}`
            : call.method === "eth_call"
              ? `0x${USDC_BALANCE.toString(16).padStart(64, "0")}`
              : "0x0",
      }));
      return new Response(JSON.stringify(Array.isArray(body) ? reply : reply[0]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // --- Blockscout v2 (counters for metrics, transfer lists for drain) ---
    if (url.includes("/api/v2/addresses/")) {
      if (url.includes("/counters")) {
        if (down.metrics) return dead;
        return new Response(JSON.stringify({ transactions_count: 121 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/token-transfers")) {
        if (down.drain) return dead;
        return new Response(JSON.stringify({ items: usdcTransfers, next_page_params: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/transactions")) {
        if (down.drain) return dead;
        return new Response(
          JSON.stringify({ items: [...v2Native].reverse(), next_page_params: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
    }

    // --- Blockscout v1 (wallet-metrics history walk) ---
    const params = new URL(url).searchParams;
    if (params.get("action") === "txlist" && params.get("sort") === "asc") {
      if (down.metrics) return dead;
      return okJson(params.get("page") === "1" ? historyPage : []);
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
  process.env.BASE_RPC_URL = RPC_URL;
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

test("REQUEST BUDGET: one payee score fits inside the v1 burst limit", async () => {
  // Measured 2026-08-13: base.blockscout.com answered 429 to a single spaced
  // v1 request while /api/v2 on the same host answered 200 — the v1 limiter
  // (3 back-to-back, then a 95s penalty box that every further request renews)
  // was in a lockout production kept feeding. One payee score used to cost
  // FIVE v1 requests: the wallet-metrics walk plus the drain check's four.
  // The drain check now reads v2 and the RPC, so it costs zero, and the score
  // as a whole stays inside the burst the limiter actually allows.
  const seen: string[] = [];
  const stubbed = (() => {
    upstream({});
    return globalThis.fetch;
  })();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("blockscout") || url.includes("BLOCKSCOUT")) seen.push(url);
    return stubbed(input, init);
  }) as typeof fetch;

  freshCaches();
  const result = await scorePayeeWallet(WALLET);
  assert.equal(result.degraded, false, "the healthy path must not be degraded");

  const v1 = seen.filter((url) => !url.includes("/api/v2/"));
  assert.ok(
    v1.length <= 3,
    `one score cost ${v1.length} v1 requests, above the measured burst budget of 3:\n${v1.join("\n")}`,
  );
  // Named individually so a future re-introduction is obvious in the failure.
  for (const action of ["sort=desc", "action=balance", "action=tokentx", "action=tokenbalance"]) {
    assert.ok(
      !v1.some((url) => url.includes(action)),
      `the drain check is back on v1 (${action}) — it must read v2 and the RPC`,
    );
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

// ---- the two silent-[] paths that fed this engine ---------------------------
// Neither can be exercised without a live database, and this suite must never
// write to the production ledger. So the behavioural half (does the flag land
// in the degraded class at all?) is asserted directly, and the wiring half is
// pinned against the source — the same shape tests/verdict-consistency.test.ts
// uses for the seller-side engine's cache rule.

test("outcome_history_unavailable is a real degraded flag, not an inert string", () => {
  // The flag only fails closed if it matches the `*_unavailable` class. A name
  // like "outcome_history_error" would have been silently inert.
  assert.equal(hasUnavailableInput(["outcome_history_unavailable"]), true);
  assert.equal(assessSybilRisk(["outcome_history_unavailable"]), "high");
});

test("a failed outcome-history read is never served as 'no history'", () => {
  // `[]` is what caps a confirmed_fraud wallet at 15 — or fails to. Returning
  // it for a connection reset scored a wallet with recorded fraud as clean.
  const src = readSrc("lib/db/outcome-writer.ts");
  const body = src.slice(src.indexOf("export async function getOutcomesForWallet"));
  const fn = body.slice(0, body.indexOf("\nexport "));
  assert.match(
    fn,
    /catch \(err\) \{[\s\S]*?isMissingSchemaError\(err\)/,
    "the degrade-to-empty must be narrowed to a missing table",
  );
  assert.match(
    fn,
    /throw new Error\("outcome_history_unavailable"/,
    "every other failure must throw so the caller can fail closed",
  );
});

test("the payee engine flags a failed outcome-history read", () => {
  const src = readSrc("lib/scoring/payee-engine.ts");
  assert.match(
    src,
    /catch \(error\) \{[\s\S]{0,200}?flags\.push\("outcome_history_unavailable"\)/,
    "getOutcomesForWallet's throw must become a flag, not a 500",
  );
});

test("a degraded verdict is never written to the trust_events ledger", () => {
  // trust_events is what /accuracy is computed from. Measured 2026-08-12: 15 of
  // 17 known-good addresses were logged BLOCK during a Blockscout lockout and
  // published as an 88.2% false-positive rate. The seller side stopped doing
  // this in 8b0df27; the payee route had not.
  const src = readSrc("lib/db/persistence.ts");
  const body = src.slice(src.indexOf("export async function persistPayeeScoreResult"));
  const fn = body.slice(0, body.indexOf("\nexport "));
  assert.match(fn, /if \(result\.degraded\) return;/);
  assert.ok(
    fn.indexOf("if (result.degraded) return;") < fn.indexOf("db.insert"),
    "the guard must come before the insert",
  );
});

test("the payee page does not pin a verdict for longer than the engine trusts it", () => {
  // /agent/[id] held one flap of the 2026-08-12 outage for 300s this way.
  const page = readFileSync(
    join(process.cwd(), "src", "app", "payee", "[address]", "page.tsx"),
    "utf8",
  );
  assert.ok(
    !/export const revalidate\s*=\s*[1-9]/.test(page),
    "a non-zero revalidate would outlive the engine's own confidence",
  );
  assert.match(page, /export const dynamic = "force-dynamic";/);
});
