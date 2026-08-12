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
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import {
  fetchWalletHistoryHead,
  fetchWalletTransactions,
  resetBlockscoutRateGate,
  BlockscoutUnavailableError,
} from "@/lib/chain/blockscout";
import { fetchWalletMetrics, invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";

const WALLET = "0x89e9e1ab11dd1b138b1dce6d6a4a0926aafd5029" as Address;
const realFetch = globalThis.fetch;

// Pacing is real time. Cases that are not ABOUT pacing opt out of it; the ones
// that are set their own interval explicitly.
beforeEach(() => {
  process.env.BLOCKSCOUT_MIN_INTERVAL_MS = "0";
  process.env.BLOCKSCOUT_COOLDOWN_MS = "0";
  resetBlockscoutRateGate();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  invalidateWalletMetricsCache(WALLET);
  invalidateWalletMetricsCache(WALLET2);
  delete process.env.BLOCKSCOUT_MIN_INTERVAL_MS;
  delete process.env.BLOCKSCOUT_COOLDOWN_MS;
  resetBlockscoutRateGate();
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

test("a network blip is retried instead of becoming a verdict", async () => {
  // A dropped socket is not a rate limit: it carries no penalty for asking
  // again, so it keeps the immediate retry.
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  const txs = await fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 });
  assert.equal(calls, 2, "a network error must be retried, not surfaced");
  assert.equal(txs.length, 1, "the retry's data is what the caller receives");
});

test("a rate limit is NOT retried — retrying is what deepens the penalty box", async () => {
  // Measured 2026-08-13: base.blockscout.com refuses the 4th rapid v1 request
  // and then keeps refusing for 95+ seconds, with every request made while
  // limited extending the lockout. The old policy fired three requests 250ms
  // apart per address; across a 42-address scan that is ~126 requests spent
  // making the outage worse. The refusal must cost exactly one request.
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return rateLimited();
  };

  await assert.rejects(
    () => fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    (error: unknown) => error instanceof BlockscoutUnavailableError,
    "a rate-limited read must surface as an error, never as empty data",
  );
  assert.equal(calls, 1, `a 429 must not be retried (saw ${calls} upstream requests)`);
});

test("after a refusal, further requests are withheld instead of fired", async () => {
  // The circuit breaker. Once refused, we stop spending requests we already
  // know will be refused — but the caller still gets an error, so the verdict
  // still fails closed. Cheaper failure, identical safety.
  process.env.BLOCKSCOUT_COOLDOWN_MS = "60000";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return rateLimited();
  };

  await assert.rejects(() => fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }));
  assert.equal(calls, 1);

  await assert.rejects(
    () => fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    (error: unknown) =>
      error instanceof BlockscoutUnavailableError &&
      error.message === "blockscout_rate_limit_cooldown",
    "a call inside the cooldown must still fail — withholding the request is not permission to pass",
  );
  assert.equal(calls, 1, "no second request may be fired into an open cooldown");
});

test("v1 request starts are paced so a scan cannot fire the burst that trips the limiter", async () => {
  // The actual repair. Three back-to-back v1 requests draw a 429, and the
  // previous code had no pacing at all: the weekly benchmark scanned 42
  // addresses as fast as it could, tripped the limiter on the 5th, and failed
  // closed on the remaining 37.
  process.env.BLOCKSCOUT_MIN_INTERVAL_MS = "60";
  resetBlockscoutRateGate();

  const startedAt: number[] = [];
  globalThis.fetch = async () => {
    startedAt.push(Date.now());
    return jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  await Promise.all([
    fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
    fetchWalletTransactions(WALLET, { sort: "asc", offset: 1 }),
  ]);

  assert.equal(startedAt.length, 4);
  for (let i = 1; i < startedAt.length; i++) {
    const gap = startedAt[i] - startedAt[i - 1];
    assert.ok(gap >= 50, `request ${i + 1} started only ${gap}ms after the previous one`);
  }
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

  // One metrics fetch is now a single walk (history head + funder + tx count in
  // one pass). Four independent scorers would multiply that by four.
  assert.equal(
    upstreamCalls,
    1,
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

// ============================================================
// 2026-08-13: estimateTransactionCount がこの限界そのものを自分で踏んでいた。
//
// スコアリングが tx 数を使うのは normalizeWalletScore の `txCount >= 100`
// 段までで、それ以上は区別しない。なのに関数は毎ページ100件返る限り
// 20ページ＝2000件ぶんを、活動量に関わらず必ず最後まで走査していた。
// Binance のホットウォレットのような高活動アドレスは常に20ページ全部を
// 消費し、それだけで「~15リクエストで429が始まる」上限を単独で超える。
// 実測（本番、2026-08-13）: 既知の正常アドレス（Binance ホットウォレット等）が
// wallet_metrics_unavailable → high risk → BLOCK になり、/accuracy の
// known-good 誤検知率が 17/17=100% になった。過去に燃えた/agent/[id]の事故と
// 同じ機構だが、震源は新規ウォレットではなく「活動が多すぎるウォレット」
// ——信頼シグナルの向きが逆転している。
// ============================================================
const WALLET2 = "0x2222222222222222222222222222222222222222" as Address;

function txPage(n: number, fromSelf = false): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    hash: `0x${i}`,
    blockNumber: "1",
    timeStamp: "1000",
    from: fromSelf ? WALLET2 : "0x9999999999999999999999999999999999999999",
    to: WALLET2,
    value: "1",
  }));
}

test("txCount の走査は、スコアリングが区別できる閾値(100)に届いたら止まる", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    // 毎ページ満杯(100件)を返し続ける——高活動ウォレットの実際の形。
    return jsonResponse({ status: "1", message: "OK", result: txPage(100) });
  };

  const head = await fetchWalletHistoryHead(WALLET2);
  assert.ok(head.nonSelfTxCount >= 100, `100件到達を検出できていない (got ${head.nonSelfTxCount})`);
  assert.ok(
    calls <= 2,
    `100件は1ページ目で届くはずなのに ${calls} リクエスト——早期終了していない`,
  );
});

test("活動が薄いウォレットは従来どおり全ページ数える(閾値未満は取りこぼさない)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    // 1ページ目に30件、2ページ目で尽きる——早期終了条件に達しない通常ケース。
    return calls === 1
      ? jsonResponse({ status: "1", message: "OK", result: txPage(30) })
      : jsonResponse({ status: "1", message: "OK", result: [] });
  };

  const head = await fetchWalletHistoryHead(WALLET2);
  assert.equal(head.nonSelfTxCount, 30);
  assert.equal(calls, 1, "1ページ目が満杯未満なら、そこで履歴の終わりが分かる");
});

test("自分宛の送金(self-transfer)は活動量に数えない——ガス代で活動を水増しできない", async () => {
  // 統合前の estimateTransactionCount が持っていた性質。1つの走査にまとめても
  // 落とさないことを固定する。
  globalThis.fetch = async () =>
    jsonResponse({ status: "1", message: "OK", result: [...txPage(10, true), ...txPage(3)] });

  const head = await fetchWalletHistoryHead(WALLET2);
  assert.equal(head.nonSelfTxCount, 3, "self-transfer 10件は数えてはいけない");
});

test("1回のスコアが Blockscout に投げる要求は1つ——年齢・資金元・取引数を1走査で得る", async () => {
  // 統合前は、同じウォレットの同じ履歴に対して昇順の走査と降順の走査を
  // 同時に投げていた。v1 は3要求で429を返すので、最安のスコア1回が
  // バースト予算の2/3を使っていた。42件の週次スキャンが5件目で限界に触れ、
  // 残る37件を全部 fail-closed で BLOCK にした震源がこれ。
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({ status: "1", message: "OK", result: OK_TXS });
  };

  const metrics = await fetchWalletMetrics(WALLET);
  assert.equal(calls, 1, `1スコアあたり1要求のはずが ${calls} 要求`);
  assert.equal(metrics.ageDays, 189, "年齢は最古の取引から取れている");
  assert.equal(metrics.txCount, 1, "取引数も同じ走査から取れている");
  assert.equal(
    metrics.funder?.toLowerCase(),
    "0x1111111111111111111111111111111111111111",
    "資金元も同じ走査から取れている",
  );
});
