// ============================================================
// Vouch — Blockscout is the single source of wallet age / tx-count / funder
// data, and it rate-limits. Measured 2026-08-12 against base.blockscout.com:
// a burst shaped like the one a score produces starts drawing HTTP 429
// "Too many requests" after ~15 requests and keeps drawing it for a while.
//
// That is what took the showcase agent to 48/BLOCK with sybilRisk:"high" and
// walletAgeDays 0, held across three independent recomputations: every
// verdict surface expires together, each starts its own fetch for the same
// wallet, the limiter trips, fetchWalletMetrics throws, and the engine
// (correctly) fails closed on wallet_metrics_unavailable. Probing the API
// from outside with a few spaced requests says it is perfectly healthy —
// the load pattern is what fails, not the endpoint.
//
// Two things must hold at once, and the second is the one worth guarding:
//   1. a recoverable blip must not become a verdict (retry, coalesce);
//   2. an UNrecoverable read must STILL fail closed. Making failures rarer
//      must never shade into making them pass.
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { fetchWalletTransactions, BlockscoutUnavailableError } from "@/lib/chain/blockscout";
import { fetchWalletMetrics, invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";

const WALLET = "0x89e9e1ab11dd1b138b1dce6d6a4a0926aafd5029" as Address;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  invalidateWalletMetricsCache(WALLET);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK_TXS = [
  {
    hash: "0xabc",
    blockNumber: "100",
    timeStamp: String(Math.floor(Date.now() / 1000) - 189 * 24 * 60 * 60),
    from: "0x1111111111111111111111111111111111111111",
    to: WALLET,
    value: "1000",
  },
];

/** Blockscout's real rate-limit refusal: HTTP 429. */
function rateLimited(): Response {
  return jsonResponse(
    { status: "0", message: "Too many requests. Increase limits now at https://dev.blockscout.com" },
    429,
  );
}

test("a rate-limited request is retried instead of becoming a verdict", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    // Trip once, then recover — the shape of a real blip.
    return calls === 1 ? rateLimited() : jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  const txs = await fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 });
  assert.equal(calls, 2, "the 429 must be retried, not surfaced");
  assert.equal(txs.length, 1, "the retry's data is what the caller receives");
});

test("Blockscout's 200-with-status-0 rate-limit refusal is retried too", async () => {
  // The same refusal is sometimes served as HTTP 200 with status:"0". Reading
  // only the HTTP code would miss it and hand the caller a hard failure.
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? jsonResponse({ status: "0", message: "Max rate limit reached" })
      : jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  const txs = await fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 });
  assert.equal(calls, 2, "a rate-limit message must be read as transient whatever the HTTP code");
  assert.equal(txs.length, 1);
});

test("FAIL-CLOSED: a rate limit that never clears still throws", async () => {
  // The guard on the fix itself. Retrying must make failure rarer, never
  // optional — an exhausted retry budget is still a failed read.
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return rateLimited();
  };

  await assert.rejects(
    () => fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    (error: unknown) => error instanceof BlockscoutUnavailableError,
    "a persistently rate-limited read must surface as an error, never as empty data",
  );
  assert.ok(calls > 1 && calls <= 3, `retries must be bounded (saw ${calls} attempts)`);
});

test("FAIL-CLOSED: a failed read never becomes an empty result", async () => {
  // The dangerous shape: "no transactions" and "we could not ask" must not
  // collapse into the same answer, because an empty history reads as a brand
  // new wallet rather than an unknown one.
  globalThis.fetch = async () => jsonResponse({ status: "0", message: "Internal server error" }, 500);

  await assert.rejects(
    () => fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    (error: unknown) => error instanceof BlockscoutUnavailableError,
  );
});

test("a client error is NOT retried (repeating a bad request just spends the limit)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({ status: "0", message: "Invalid address format" }, 400);
  };

  await assert.rejects(() => fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }));
  assert.equal(calls, 1, "400 means the request is wrong; repeating it changes nothing");
});

test("concurrent scorers of the same wallet make ONE upstream fetch, not one each", async () => {
  // /agent/[id], the passport endpoint, /api/demo/score and the leaderboard all
  // expire together and all score the same wallet. Without coalescing that is
  // four simultaneous fetch storms into a rate limiter — and four independently
  // computed answers that can disagree, which is exactly how one agent showed
  // ALLOW on its own page and BLOCK on the passport it links to.
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  const results = await Promise.all([
    fetchWalletMetrics(WALLET),
    fetchWalletMetrics(WALLET),
    fetchWalletMetrics(WALLET),
    fetchWalletMetrics(WALLET),
  ]);

  // One metrics fetch is 2 upstream branches (history head + tx count), each of
  // which may page. Four independent scorers would multiply that by four.
  assert.ok(
    upstreamCalls <= 4,
    `four concurrent scorers must share one fetch, saw ${upstreamCalls} upstream calls`,
  );

  const first = JSON.stringify(results[0]);
  for (const r of results) {
    assert.equal(JSON.stringify(r), first, "coalesced callers must observe the SAME metrics");
  }
});

test("concurrent scorers share the failure too — nobody gets a luckier answer", async () => {
  globalThis.fetch = async () => rateLimited();

  const settled = await Promise.allSettled([
    fetchWalletMetrics(WALLET),
    fetchWalletMetrics(WALLET),
    fetchWalletMetrics(WALLET),
  ]);

  for (const s of settled) {
    assert.equal(s.status, "rejected", "a failed read must fail for every sharer");
    assert.equal(
      (s as PromiseRejectedResult).reason?.message,
      "wallet_metrics_unavailable",
      "and it must stay the flag the engine fails closed on",
    );
  }
});

test("a failed metrics read is not cached — the next call retries from scratch", async () => {
  let phase: "fail" | "ok" = "fail";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return phase === "fail"
      ? rateLimited()
      : jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  await assert.rejects(() => fetchWalletMetrics(WALLET));
  const failedCalls = calls;

  phase = "ok";
  const metrics = await fetchWalletMetrics(WALLET);
  assert.ok(calls > failedCalls, "the failure must not have been cached as an answer");
  assert.equal(metrics.ageDays, 189, "and the recovered read produces the real age");
});
