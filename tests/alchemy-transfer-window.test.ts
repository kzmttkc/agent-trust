// ============================================================
// Vouch — Alchemy is the first history provider, and it did not soften
// anything on the way in.
//
// MEASURED 2026-08-13 for 0xd8dA…6045 (vitalik.eth, 37,157 transactions on
// Base), the same 100-transfer window, three attempts each:
//
//   base.blockscout.com v1, WITH BLOCKSCOUT_API_KEY   429 / 429 / 429
//   api.blockscout.com/8453 gateway, WITH the key     500 / 500 / 500
//   Alchemy alchemy_getAssetTransfers                 200 / 200 / 200
//                                                     1,310 / 2,200 / 1,510ms
//
// The key does not buy the v1 limiter off and the hosted gateway times the
// query out inside its own planner, so before this change the product simply
// could not answer for the first address a visitor tries.
//
// What these cases pin is not "Alchemy is fast". It is that moving the source
// changed the SOURCE and nothing else:
//   - the response shape is parsed from the raw hex amounts, not the float;
//   - the two asset legs stay independently measured and independently
//     disclosed (73bb96c), so one provider failure cannot erase a leg that
//     answered;
//   - a partially measured wallet is still capped below ALLOW;
//   - an unread wallet is still a fail-closed BLOCK;
//   - Blockscout still carries traffic when Alchemy cannot.
// ============================================================
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { BASE_USDC_ADDRESS, SCORE_THRESHOLDS } from "@/lib/chain/config";
import { resetBlockscoutRateGate } from "@/lib/chain/blockscout";
import { fetchAlchemyHistoryHead, fetchAlchemyTransferWindow } from "@/lib/chain/alchemy";
import { fetchWalletMetrics, invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { invalidatePayeeScoreCache, scorePayeeWallet } from "@/lib/scoring/payee-engine";

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address;
const WALLET_LOWER = WALLET.toLowerCase();
const FUNDER = "0x000000000000000000000000000000000000dead";
const COUNTERPARTY = "0x000000000000000000000000000000000000beef";
const realFetch = globalThis.fetch;
const RPC_URL = "https://rpc.test.invalid";
const now = Math.floor(Date.now() / 1000);
const AGE_DAYS = 200;

const NATIVE_BALANCE = 900_000_000_000_000n;
const USDC_BALANCE = 4_000_000_000n;

const jsonBody = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** One `alchemy_getAssetTransfers` row, in the exact shape the live API
 *  returns — including the lossy float `value` alongside the authoritative
 *  hex in `rawContract.value`, because telling those two apart is half of what
 *  the parser has to get right. */
function row(params: {
  hash: string;
  from: string;
  to: string | null;
  raw: bigint;
  category: "external" | "erc20";
  daysAgo: number;
  block: number;
  token?: string;
  logIndex?: number;
}) {
  const decimals = params.category === "erc20" ? 6 : 18;
  return {
    blockNum: `0x${params.block.toString(16)}`,
    uniqueId: `${params.hash}:${params.category === "external" ? "external" : `log:${params.logIndex ?? 0}`}`,
    hash: params.hash,
    from: params.from,
    to: params.to,
    value: Number(params.raw) / 10 ** decimals,
    erc721TokenId: null,
    erc1155Metadata: [],
    tokenId: null,
    asset: params.category === "erc20" ? "USDC" : "ETH",
    category: params.category,
    rawContract: {
      value: `0x${params.raw.toString(16)}`,
      address: params.token ?? null,
      decimal: `0x${decimals.toString(16)}`,
    },
    metadata: {
      blockTimestamp: new Date((now - params.daysAgo * 86_400) * 1000).toISOString(),
    },
  };
}

const USDC = BASE_USDC_ADDRESS.toLowerCase();

/** Native inflow: 0.001 ETH, 200 days ago. The wallet's funding transfer. */
const nativeIn = [
  row({ hash: "0xn1", from: FUNDER, to: WALLET_LOWER, raw: 1_000_000_000_000_000n, category: "external", daysAgo: AGE_DAYS, block: 100 }),
];
/** Native outflow: none of consequence — a single dust send, far under the
 *  0.005 ETH floor, so the native leg is healthy rather than "drained". */
const nativeOut = [
  row({ hash: "0xn2", from: WALLET_LOWER, to: COUNTERPARTY, raw: 1_000_000_000_000n, category: "external", daysAgo: 10, block: 500 }),
];
/** USDC: received 5,000, paid out 1,000, 4,000 left → a 0.2 ratio. The same
 *  wallet story the Blockscout fixtures tell, so a verdict reached through
 *  either provider is directly comparable. */
const usdcIn = [
  row({ hash: "0xu1", from: COUNTERPARTY, to: WALLET_LOWER, raw: 5_000_000_000n, category: "erc20", daysAgo: 30, block: 300, token: USDC, logIndex: 1 }),
];
const usdcOut = [
  row({ hash: "0xu2", from: WALLET_LOWER, to: COUNTERPARTY, raw: 1_000_000_000n, category: "erc20", daysAgo: 20, block: 400, token: USDC, logIndex: 2 }),
];

/** 120 further outgoing ERC-20 rows so the ASCENDING metrics read has a real
 *  activity count to saturate on. */
const metricsOut = Array.from({ length: 120 }, (_, i) =>
  row({
    hash: `0xm${i}`,
    from: WALLET_LOWER,
    to: COUNTERPARTY,
    raw: 1_000_000n,
    category: "erc20",
    daysAgo: AGE_DAYS - 1 - (i % 150),
    block: 1_000 + i,
    token: USDC,
    logIndex: 3,
  }),
);

type Upstream = {
  /** Alchemy refuses the native (external-category) window. */
  alchemyNativeDown?: boolean;
  /** Alchemy refuses the ERC-20 window. */
  alchemyErc20Down?: boolean;
  /** Alchemy refuses everything, including the metrics head. */
  alchemyDown?: boolean;
  /** Alchemy answers HTTP 200 with a body that is not the shape we asked for. */
  alchemyBadShape?: boolean;
  /** Every Blockscout endpoint refuses. */
  blockscoutDown?: boolean;
  /** Alchemy reports the wallet has no transfers at all. */
  alchemyEmpty?: boolean;
};

const seen: { alchemy: unknown[]; blockscout: string[] } = { alchemy: [], blockscout: [] };

function upstream(state: Upstream) {
  seen.alchemy = [];
  seen.blockscout = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.startsWith(RPC_URL)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as
        | { method?: string; id?: number }[]
        | { method?: string; id?: number };
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

    if (url.includes("g.alchemy.com")) {
      const params = JSON.parse(String(init?.body ?? "{}")).params[0] as {
        toAddress?: string;
        fromAddress?: string;
        category: string[];
        order: "asc" | "desc";
        contractAddresses?: string[];
      };
      seen.alchemy.push(params);

      if (state.alchemyDown) return new Response("nope", { status: 503 });
      if (state.alchemyBadShape) return jsonBody({ jsonrpc: "2.0", id: 1, result: { ok: true } });

      const inbound = Boolean(params.toAddress);
      const erc20Only = params.category.length === 1 && params.category[0] === "erc20";
      const externalOnly = params.category.length === 1 && params.category[0] === "external";

      if (externalOnly && params.order === "desc" && state.alchemyNativeDown) {
        return new Response("nope", { status: 503 });
      }
      if (erc20Only && state.alchemyErc20Down) {
        return new Response("nope", { status: 503 });
      }
      if (state.alchemyEmpty) return jsonBody({ jsonrpc: "2.0", id: 1, result: { transfers: [] } });

      // The DESCENDING reads are the drain window, one asset class each.
      if (params.order === "desc") {
        if (externalOnly) {
          return jsonBody({
            jsonrpc: "2.0",
            id: 1,
            result: { transfers: inbound ? nativeIn : nativeOut },
          });
        }
        // ERC-20 window, filtered to USDC by contractAddresses.
        assert.deepEqual(params.contractAddresses, [BASE_USDC_ADDRESS]);
        return jsonBody({
          jsonrpc: "2.0",
          id: 1,
          result: { transfers: inbound ? usdcIn : usdcOut },
        });
      }

      // ASCENDING: the wallet-metrics history head.
      if (externalOnly) {
        // Funder lookup: oldest incoming NATIVE value transfer.
        return jsonBody({ jsonrpc: "2.0", id: 1, result: { transfers: inbound ? nativeIn : nativeOut } });
      }
      return jsonBody({
        jsonrpc: "2.0",
        id: 1,
        result: { transfers: inbound ? [...nativeIn, ...usdcIn] : [...nativeOut, ...metricsOut] },
      });
    }

    seen.blockscout.push(url);
    if (state.blockscoutDown) return new Response("upstream is down", { status: 503 });

    if (url.includes("/api/v2/addresses/")) {
      if (url.includes("/counters")) return jsonBody({ transactions_count: 121 });
      if (url.includes("/token-transfers")) {
        return jsonBody({
          items: [...usdcIn, ...usdcOut].map((tx) => ({
            transaction_hash: tx.hash,
            block_number: Number(BigInt(tx.blockNum)),
            timestamp: tx.metadata.blockTimestamp,
            total: { value: BigInt(tx.rawContract.value).toString() },
            from: { hash: tx.from },
            to: { hash: tx.to },
            token: { address_hash: BASE_USDC_ADDRESS as string },
          })),
          next_page_params: null,
        });
      }
      return jsonBody({
        items: [...nativeIn, ...nativeOut].map((tx) => ({
          hash: tx.hash,
          block_number: Number(BigInt(tx.blockNum)),
          timestamp: tx.metadata.blockTimestamp,
          value: BigInt(tx.rawContract.value).toString(),
          from: { hash: tx.from },
          to: { hash: tx.to },
        })),
        next_page_params: null,
      });
    }

    // Blockscout v1 (etherscan-compatible), used by the metrics walk.
    const search = new URL(url).searchParams;
    const v1 = (rows: typeof nativeIn) =>
      new Response(
        JSON.stringify({
          status: "1",
          message: "OK",
          result: rows.map((tx) => ({
            hash: tx.hash,
            blockNumber: String(BigInt(tx.blockNum)),
            timeStamp: String(Math.floor(Date.parse(tx.metadata.blockTimestamp) / 1000)),
            from: tx.from,
            to: tx.to ?? COUNTERPARTY,
            value: BigInt(tx.rawContract.value).toString(),
            contractAddress: tx.rawContract.address ?? "",
            tokenDecimal: "6",
            tokenSymbol: "USDC",
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (search.get("page") !== "1") return v1([]);
    if (search.get("action") === "tokentx") return v1([...usdcIn, ...usdcOut]);
    return v1([...nativeIn, ...nativeOut]);
  }) as typeof fetch;
}

function freshCaches() {
  invalidatePayeeScoreCache(WALLET);
  invalidateWalletMetricsCache(WALLET);
  resetBlockscoutRateGate();
}

const TOUCHED_ENV = [
  "ALCHEMY_API_KEY",
  "ALCHEMY_BUDGET_MS",
  "BLOCKSCOUT_MIN_INTERVAL_MS",
  "BLOCKSCOUT_COOLDOWN_MS",
  "PAYEE_LEG_BUDGET_MS",
  "PAYEE_V2_BUDGET_MS",
  "PAYEE_V1_BUDGET_MS",
  "PAYEE_HEDGE_AFTER_MS",
  "WALLET_METRICS_COUNTER_BUDGET_MS",
];

beforeEach(() => {
  process.env.ALCHEMY_API_KEY = "test-key";
  process.env.ALCHEMY_BUDGET_MS = "800";
  process.env.BLOCKSCOUT_MIN_INTERVAL_MS = "0";
  process.env.BLOCKSCOUT_COOLDOWN_MS = "0";
  process.env.BLOCKSCOUT_API_URL = "https://base.blockscout.com/api";
  process.env.BASE_RPC_URL = RPC_URL;
  process.env.PAYEE_LEG_BUDGET_MS = "1500";
  process.env.PAYEE_V2_BUDGET_MS = "400";
  process.env.PAYEE_V1_BUDGET_MS = "400";
  process.env.PAYEE_HEDGE_AFTER_MS = "60";
  process.env.WALLET_METRICS_COUNTER_BUDGET_MS = "300";
  delete process.env.SKIP_CHAIN_READS;
  delete process.env.DATABASE_URL;
  freshCaches();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  freshCaches();
  for (const key of TOUCHED_ENV) delete process.env[key];
});

test("ALCHEMY IS FIRST: a healthy score touches Blockscout zero times", async () => {
  // The whole point of the move. Blockscout answered 429/500 for exactly the
  // wallets the product most needs to score, so the healthy path must not
  // depend on it at all — not for the drain window, not for the metrics head,
  // and not for the /counters short-circuit.
  upstream({});
  const result = await scorePayeeWallet(WALLET);

  assert.equal(result.degraded, false, `flags: ${result.signals.flags.join(",")}`);
  assert.deepEqual(result.signalsUnavailable, []);
  assert.deepEqual(
    seen.blockscout,
    [],
    `Alchemy was healthy but Blockscout was still called:\n${seen.blockscout.join("\n")}`,
  );
  assert.equal(result.signals.walletHealth.ageDays, AGE_DAYS);
  assert.ok(result.signals.walletHealth.txCount >= 100, "the activity count should saturate");
  assert.equal(result.signals.drainPattern.detected, false);
});

test("RESPONSE SHAPE: amounts come from the raw hex, not the lossy float", async () => {
  // Alchemy reports `value` as a JSON number. A USDC amount above 2^53 units,
  // or any amount with more significant digits than a double can hold, is
  // silently rounded there — and the drain ratio is the one number in this
  // engine that must not drift. rawContract.value is the authority.
  const huge = 123_456_789_012_345_678_901n;
  globalThis.fetch = (async () =>
    jsonBody({
      jsonrpc: "2.0",
      id: 1,
      result: {
        transfers: [
          row({
            hash: "0xbig",
            from: COUNTERPARTY,
            to: WALLET_LOWER,
            raw: huge,
            category: "erc20",
            daysAgo: 1,
            block: 9,
            token: USDC,
          }),
        ],
      },
    })) as typeof fetch;

  const transfers = await fetchAlchemyTransferWindow(WALLET, {
    categories: ["erc20"],
    contractAddress: BASE_USDC_ADDRESS,
    limit: 100,
  });
  assert.equal(transfers[0]!.value, huge.toString());
  // Both directions are read and merged, and the same row arriving on both
  // sides is counted once.
  assert.equal(transfers.length, 1);
});

test("PER-ASSET INDEPENDENCE: a dead native leg does not erase the USDC leg", async () => {
  // 73bb96c's ruling, carried across the provider change. Alchemy could serve
  // both assets in ONE request; it deliberately does not, because a shared
  // request makes every hiccup a double failure. Here Alchemy refuses the
  // native window and Blockscout is down too — the USDC measurement survives,
  // is used, and the missing leg is DISCLOSED rather than averaged away.
  upstream({ alchemyNativeDown: true, blockscoutDown: true });
  const result = await scorePayeeWallet(WALLET);

  assert.deepEqual(result.signals.drainPattern.unmeasured, ["native_drain"]);
  assert.deepEqual(result.signalsUnavailable, ["native_drain"]);
  assert.equal(result.degraded, false, "a measured leg is not 'we know nothing'");
  assert.equal(result.signals.drainPattern.incomingCount, 1, "the USDC leg was really read");
  // Partial reading: capped one point below ALLOW, so it can never clear the
  // gate the SDK's SpendGuard consults before releasing funds.
  assert.ok(
    result.score <= SCORE_THRESHOLDS.allow - 1,
    `partial reading cleared the ALLOW cap: ${result.score}`,
  );
  assert.notEqual(result.recommendation, "ALLOW");
});

test("PER-ASSET INDEPENDENCE: a dead USDC leg does not erase the native leg", async () => {
  upstream({ alchemyErc20Down: true, blockscoutDown: true });
  const result = await scorePayeeWallet(WALLET);

  assert.deepEqual(result.signals.drainPattern.unmeasured, ["usdc_drain"]);
  assert.equal(result.degraded, false);
  assert.ok(result.score <= SCORE_THRESHOLDS.allow - 1);
});

test("FAIL-CLOSED: no provider answers → degraded BLOCK, never a quiet pass", async () => {
  upstream({ alchemyDown: true, blockscoutDown: true });
  const result = await scorePayeeWallet(WALLET);

  assert.equal(result.degraded, true);
  assert.equal(result.recommendation, "BLOCK");
  assert.ok(result.signals.flags.includes("drain_check_unavailable"));
  assert.ok(result.signals.flags.includes("wallet_metrics_unavailable"));
  assert.ok(result.score <= SCORE_THRESHOLDS.warn - 1);
  // A wallet nobody managed to look at must not be ACCUSED of being a burner.
  assert.equal(result.signals.walletHealth.isBurner, false);
});

test("BAD SHAPE: a 200 that is not the shape we asked for is a failed read, not an empty history", async () => {
  // The asymmetry that cost the Blockscout v2 reader a silent "this wallet has
  // moved nothing": unparseable JSON threw, but well-formed JSON with no
  // transfers array fell through as EMPTY. Empty history means no outflow,
  // which means no drain ratio, which scores near-neutral with no
  // `*_unavailable` flag anywhere.
  upstream({ alchemyBadShape: true, blockscoutDown: true });
  const result = await scorePayeeWallet(WALLET);
  assert.equal(result.degraded, true);
  assert.equal(result.recommendation, "BLOCK");
});

test("FALLBACK: Alchemy unreachable → Blockscout still produces a real verdict", async () => {
  // A degraded second source beats none. Blockscout stays wired in behind
  // Alchemy for exactly this.
  upstream({ alchemyDown: true });
  const result = await scorePayeeWallet(WALLET);

  assert.equal(result.degraded, false, `flags: ${result.signals.flags.join(",")}`);
  assert.deepEqual(result.signalsUnavailable, []);
  assert.ok(seen.blockscout.length > 0, "the fallback should have carried this read");
  assert.equal(result.signals.walletHealth.ageDays, AGE_DAYS);
});

test("NOT CONFIGURED: without a key nothing is attempted and Blockscout runs unchanged", async () => {
  delete process.env.ALCHEMY_API_KEY;
  upstream({});
  const result = await scorePayeeWallet(WALLET);

  assert.deepEqual(seen.alchemy, [], "an unconfigured provider must not be called");
  assert.equal(result.degraded, false);
});

test("WALLET METRICS: age, activity and funder all come from Alchemy", async () => {
  upstream({});
  const metrics = await fetchWalletMetrics(WALLET);

  assert.equal(metrics.ageDays, AGE_DAYS);
  assert.ok(metrics.txCount >= 100);
  // The funder rule is UNCHANGED on purpose: oldest incoming transfer with a
  // non-zero NATIVE value. The funder index (fetchFirstIncomingTransfer) is
  // keyed by that rule, and a funder derived differently would be looked up in
  // an index that cannot match it — a cluster check that silently misses is
  // the fail-open direction.
  assert.equal(metrics.funder?.toLowerCase(), FUNDER);
  assert.deepEqual(seen.blockscout, []);
});

test("WALLET METRICS: an empty Alchemy answer falls through to Blockscout, not to 'brand new'", async () => {
  // Alchemy indexes transfers of VALUE; Blockscout's txlist counts
  // transactions, 0-value contract calls included. A wallet whose whole life
  // is 0-value contract interaction would read as ageDays 0 — the
  // `new_burner_wallet` shape — off a provider that simply does not index what
  // it does. So empty is treated as "no answer", not as an answer.
  upstream({ alchemyEmpty: true });
  const metrics = await fetchWalletMetrics(WALLET);

  assert.equal(metrics.ageDays, AGE_DAYS, "the Blockscout walk should have supplied the age");
  assert.ok(
    seen.blockscout.length > 0,
    "an empty first answer must be re-asked of the second provider",
  );
});

test("HISTORY HEAD: self-transfers are still excluded from the activity count", async () => {
  // Carried over from the Blockscout walk: a wallet must not be able to
  // inflate its apparent activity by paying gas to itself.
  const selfRows = Array.from({ length: 5 }, (_, i) =>
    row({
      hash: `0xs${i}`,
      from: WALLET_LOWER,
      to: WALLET_LOWER,
      raw: 1n,
      category: "external",
      daysAgo: 5,
      block: 10 + i,
    }),
  );
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const params = JSON.parse(String(init?.body ?? "{}")).params[0] as { toAddress?: string };
    void input;
    return jsonBody({
      jsonrpc: "2.0",
      id: 1,
      result: { transfers: params.toAddress ? [...selfRows, ...nativeIn] : selfRows },
    });
  }) as typeof fetch;

  const head = await fetchAlchemyHistoryHead(WALLET);
  assert.equal(head.nonSelfTxCount, 1, "only the funding transfer is non-self");
  assert.equal(head.empty, false);
});

test("DETERMINISM: five consecutive scores of the same wallet agree", async () => {
  // The production acceptance condition. Before this change the same wallet
  // returned 70/ALLOW, 37/BLOCK and 49/WARN in one afternoon with nothing
  // changing on chain, because the verdict was decided by which upstream
  // happened to refuse.
  upstream({});
  const results = [];
  for (let i = 0; i < 5; i++) {
    freshCaches();
    results.push(await scorePayeeWallet(WALLET));
  }
  for (const result of results) {
    assert.equal(result.score, results[0]!.score, "score drifted between identical reads");
    assert.equal(result.recommendation, results[0]!.recommendation);
    assert.equal(result.degraded, false);
  }
});
