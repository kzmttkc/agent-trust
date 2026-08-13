// ============================================================
// Vouch — a busy wallet must still get a verdict.
//
// MEASURED IN PRODUCTION 2026-08-13 on /payee/0xd8dA…6045 (vitalik.eth,
// 37,157 transactions on Base): 3 of 3 loads returned "Not verifiable right
// now" in 8.4-14.6s, while /payee/0x0330070F… (0 transactions on Base)
// returned 41/WARN in ~7s from the same deploy at the same minute. Not a
// site-wide outage — a failure that only busy wallets can trigger.
//
// Where the time went, measured against base.blockscout.com the same day for
// that one address:
//
//   v1  /api?action=txlist&offset=100          1,518ms   200   (whole window, 1 request)
//   v2  /addresses/{a}/transactions            8,147ms + 6,679ms = 18,036ms  (2 pages)
//   v2  /addresses/{a}/token-transfers        18,411ms + 31,201ms = 51,979ms (2 pages)
//   v2  /addresses/{a}/counters                4,274ms warm / 70,972ms cold
//
// The payee engine gives each drain leg FETCH_TIMEOUT_MS = 8s
// (src/lib/scoring/payee-engine.ts). Both v2 legs blow it, detectDrainPattern
// reports `unavailable`, `drain_check_unavailable` is flagged, the verdict is
// degraded, and /payee/[address] prints "Not verifiable right now". The
// address every visitor tries first is the one the product cannot answer.
//
// The cause is the SHAPE of the v2 read, not the wallet: v2 pages 50 at a
// time, so the 100-transfer window is always two serial round trips, and each
// round trip's cost scales with how much history the address has. The v1
// endpoint returns the same 100-transfer window in ONE request and did so in
// 1.5s for the same address. v1 is severely rate-limited (3 back-to-back, then
// a penalty box — see the header of src/lib/chain/blockscout.ts), which is why
// the drain check was moved to v2 on 2026-08-13 in the first place.
//
// So: v2 stays the default (it costs no v1 budget), and v1 becomes the
// FALLBACK for exactly the case v2 cannot serve. The window is 100 transfers
// on both paths — a fallback that returned fewer would count less outflow,
// which is the fail-OPEN direction on a drain ratio.
//
// These tests pin that, and pin that the fallback did not soften anything:
// when BOTH sources are down the verdict is still a fail-closed BLOCK.
// ============================================================
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { BASE_USDC_ADDRESS } from "@/lib/chain/config";
import { resetBlockscoutRateGate } from "@/lib/chain/blockscout";
import { invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { invalidatePayeeScoreCache, scorePayeeWallet } from "@/lib/scoring/payee-engine";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
const realFetch = globalThis.fetch;
const RPC_URL = "https://rpc.test.invalid";
const now = Math.floor(Date.now() / 1000);

const okJson = (result: unknown) =>
  new Response(JSON.stringify({ status: "1", message: "OK", result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const jsonBody = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** 200 days old, 121 non-self transactions — comfortably healthy on every axis
 *  the engine reads, so each case is about what a failing READ does, never
 *  about a borderline wallet. Same fixture shape as payee-fail-closed.test.ts. */
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

/** v1 `tokentx` rows for the USDC leg: received 5,000, paid out 1,000 → a
 *  0.2 ratio, nowhere near a drain. Deliberately the SAME wallet story the v2
 *  fixture tells, so a verdict reached through the fallback can be compared
 *  against the v2 one directly. */
const usdcV1 = [
  {
    hash: "0xa",
    from: "0x000000000000000000000000000000000000cafe",
    to: WALLET.toLowerCase(),
    value: "5000000000",
    contractAddress: BASE_USDC_ADDRESS.toLowerCase(),
    tokenDecimal: "6",
    tokenSymbol: "USDC",
    timeStamp: String(now - 30 * 86_400),
    blockNumber: "500",
  },
  {
    hash: "0xb",
    from: WALLET.toLowerCase(),
    to: "0x000000000000000000000000000000000000feed",
    value: "1000000000",
    contractAddress: BASE_USDC_ADDRESS.toLowerCase(),
    tokenDecimal: "6",
    tokenSymbol: "USDC",
    timeStamp: String(now - 10 * 86_400),
    blockNumber: "600",
  },
];

const NATIVE_BALANCE = 900_000_000_000_000n;
const USDC_BALANCE = 4_000_000_000n;

type Upstream = {
  /** v2 transfer lists hang past the leg budget (the production symptom). */
  v2TransfersSlow?: boolean;
  /** v2 transfer lists answer HTTP 500 (the other production symptom). */
  v2TransfersDown?: boolean;
  /** v1 is in its penalty box too — nothing can answer. */
  v1Down?: boolean;
  /** /counters hangs. Its own contract says a missing answer falls through to
   *  the walk; this pins that it actually does. */
  countersSlow?: boolean;
};

const seen: string[] = [];

/** Long enough to blow any leg budget the engine sets in these tests, short
 *  enough that the suite does not crawl. */
const SLOW_MS = 900;

function upstream(state: Upstream) {
  seen.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal;

    if (url.startsWith(RPC_URL)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; id?: number }[] | { method?: string; id?: number };
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
      return jsonBody(Array.isArray(body) ? reply : reply[0]);
    }

    seen.push(url);

    /**
     * Hang until the CALLER aborts us. Deliberately not a fast rejection: the
     * production symptom is a read that answers eventually (18-52s) rather
     * than one that fails, and a stub that rejects promptly would let code
     * with no budget at all pass this suite. SLOW_MS is only a backstop so a
     * regression cannot wedge the run forever.
     */
    const hang = () =>
      new Promise<Response>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("test_upstream_hang")), SLOW_MS);
        const onAbort = () => {
          clearTimeout(timer);
          const err = new Error("aborted by caller");
          err.name = signal?.reason?.name === "TimeoutError" ? "TimeoutError" : "AbortError";
          reject(err);
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort);
      });

    if (url.includes("/api/v2/addresses/")) {
      if (url.includes("/counters")) {
        if (state.countersSlow) return hang();
        return jsonBody({ transactions_count: 121 });
      }
      // Both v2 transfer lists — the two drain legs.
      if (state.v2TransfersSlow) return hang();
      if (state.v2TransfersDown) return new Response("upstream is down", { status: 500 });
      if (url.includes("/token-transfers")) {
        return jsonBody({
          items: usdcV1.map((tx) => ({
            transaction_hash: tx.hash,
            block_number: Number(tx.blockNumber),
            timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
            total: { value: tx.value },
            from: { hash: tx.from },
            to: { hash: tx.to },
            token: { address_hash: BASE_USDC_ADDRESS as string },
          })),
          next_page_params: null,
        });
      }
      return jsonBody({
        items: [...historyPage].reverse().map((tx) => ({
          hash: tx.hash,
          block_number: Number(tx.blockNumber),
          timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
          value: tx.value,
          from: { hash: tx.from },
          to: { hash: tx.to },
        })),
        next_page_params: null,
      });
    }

    const params = new URL(url).searchParams;
    if (state.v1Down) return new Response("upstream is down", { status: 503 });

    if (params.get("action") === "txlist") {
      // page 1 holds the whole fixture; any later page is the end of history.
      return okJson(params.get("page") === "1" ? historyPage : []);
    }
    if (params.get("action") === "tokentx") {
      return okJson(params.get("page") === "1" ? usdcV1 : []);
    }

    throw new Error(`unstubbed upstream call: ${url}`);
  }) as typeof fetch;
}

function freshCaches() {
  invalidatePayeeScoreCache(WALLET);
  invalidateWalletMetricsCache(WALLET);
  resetBlockscoutRateGate();
}

beforeEach(() => {
  process.env.BLOCKSCOUT_MIN_INTERVAL_MS = "0";
  process.env.BLOCKSCOUT_COOLDOWN_MS = "0";
  process.env.BLOCKSCOUT_API_URL = "https://base.blockscout.com/api";
  process.env.BASE_RPC_URL = RPC_URL;
  // Leg budgets far under SLOW_MS so "too slow" is reached in test time.
  process.env.PAYEE_LEG_BUDGET_MS = "250";
  process.env.PAYEE_V2_BUDGET_MS = "120";
  process.env.WALLET_METRICS_COUNTER_BUDGET_MS = "120";
  delete process.env.SKIP_CHAIN_READS;
  delete process.env.DATABASE_URL;
  freshCaches();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  freshCaches();
  for (const key of [
    "BLOCKSCOUT_MIN_INTERVAL_MS",
    "BLOCKSCOUT_COOLDOWN_MS",
    "PAYEE_LEG_BUDGET_MS",
    "PAYEE_V2_BUDGET_MS",
    "WALLET_METRICS_COUNTER_BUDGET_MS",
  ]) {
    delete process.env[key];
  }
});

test("BUSY WALLET: v2 transfer reads too slow to finish still produce a real verdict", async () => {
  upstream({ v2TransfersSlow: true });
  const result = await scorePayeeWallet(WALLET);

  assert.equal(
    result.degraded,
    false,
    `still degraded — the page would print "Not verifiable right now" (flags: ${result.signals.flags.join(",")})`,
  );
  assert.equal(result.signals.drainPattern.unmeasured.length, 0, "both legs must be measured");
  assert.ok(result.score > 0);
  assert.ok(["ALLOW", "WARN", "BLOCK"].includes(result.recommendation));
});

test("BUSY WALLET: v2 answering HTTP 500 falls back rather than refusing", async () => {
  upstream({ v2TransfersDown: true });
  const result = await scorePayeeWallet(WALLET);
  assert.equal(result.degraded, false, `flags: ${result.signals.flags.join(",")}`);
  assert.equal(result.signals.drainPattern.unmeasured.length, 0);
});

test("the fallback reads the SAME window, not a smaller one", async () => {
  // A fallback that counted less outflow than the path it replaces would be a
  // quiet fail-OPEN on the drain ratio: outgoing total is the numerator.
  upstream({ v2TransfersDown: true });
  await scorePayeeWallet(WALLET);

  const v1Windows = seen.filter((url) => !url.includes("/api/v2/"));
  const drainReads = v1Windows.filter((url) => {
    const p = new URL(url).searchParams;
    return p.get("sort") === "desc";
  });
  assert.ok(drainReads.length >= 2, `expected both drain legs on the fallback, saw:\n${v1Windows.join("\n")}`);
  for (const url of drainReads) {
    assert.equal(
      new URL(url).searchParams.get("offset"),
      "100",
      `fallback shrank the drain window: ${url}`,
    );
  }
});

test("the healthy path still costs the drain check ZERO v1 requests", async () => {
  // The reason the check moved to v2 on 2026-08-13. The fallback must not
  // quietly put it back on the v1 budget for every score.
  upstream({});
  const result = await scorePayeeWallet(WALLET);
  assert.equal(result.degraded, false);

  const v1 = seen.filter((url) => !url.includes("/api/v2/"));
  for (const action of ["sort=desc", "action=tokentx"]) {
    assert.ok(
      !v1.some((url) => url.includes(action)),
      `drain check used v1 (${action}) while v2 was healthy:\n${v1.join("\n")}`,
    );
  }
});

test("FAIL-CLOSED: when BOTH sources are down the verdict is still BLOCK", async () => {
  upstream({ v2TransfersDown: true, v1Down: true });
  const result = await scorePayeeWallet(WALLET);
  assert.equal(result.degraded, true);
  assert.equal(result.recommendation, "BLOCK");
  assert.ok(result.signals.flags.includes("drain_check_unavailable"));
});

test("a slow /counters read falls through to the walk instead of failing the metrics read", async () => {
  // fetchAddressTransactionCount documents "a missing answer falls through to
  // the v1 walk". Measured 2026-08-13: that endpoint took 70,972ms cold for a
  // busy wallet, and the caller's timeout turned the fallthrough into a hard
  // wallet_metrics_unavailable — a fail-closed BLOCK caused by an OPTIONAL
  // short-circuit that exists only to SAVE requests.
  upstream({ countersSlow: true });
  const result = await scorePayeeWallet(WALLET);
  assert.ok(
    !result.signals.flags.includes("wallet_metrics_unavailable"),
    `a slow optional counter killed the whole metrics read (flags: ${result.signals.flags.join(",")})`,
  );
  assert.ok(result.signals.walletHealth.ageDays > 0, "the walk should have supplied the age");
});

test("DETERMINISM: five consecutive reads of a busy wallet agree", async () => {
  // The production acceptance condition, pinned here so it cannot regress:
  // the same wallet against the same upstream must give the same answer every
  // time, not one answer per which read happened to win the race.
  upstream({ v2TransfersSlow: true });
  const runs = [];
  for (let i = 0; i < 5; i++) {
    freshCaches();
    runs.push(await scorePayeeWallet(WALLET));
  }
  const first = runs[0]!;
  assert.equal(first.degraded, false);
  for (const run of runs) {
    assert.equal(run.score, first.score, "score flapped across reads");
    assert.equal(run.recommendation, first.recommendation, "verdict flapped across reads");
  }
});
