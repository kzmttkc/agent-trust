// ============================================================
// Vouch — outage-shaped resilience pins for the payee drain check.
//
// tests/payee-fail-closed.test.ts pins the verdict invariants (unreadable
// input → degraded → BLOCK) and the per-score v1 request budget. This file
// pins the drain check against the UPSTREAM WEATHER measured on 2026-08-13,
// the day the check moved off v1 (commit ecd1496):
//
//   - v1 (`/api?module=...`) answered 429 to everything — including a single
//     spaced request from a clean IP — so a score's only v1 spend, the
//     wallet-metrics walk, must be the only thing that suffers;
//   - v2 reads were intermittently flaky: one 500, then a clean 200 on
//     repeat. A single transient 500 must be retried, not failed closed on;
//   - a never-indexed address answers 200 {"items":[]} on the v2 transfer
//     lists (measured against a random address) — a cold-start payee is an
//     empty history, not an outage, and x402 payees start cold.
//
// None of these soften the gate: tests/payee-fail-closed.test.ts keeps
// pinning that a v2 outage that survives the retry still refuses to certify.
// ============================================================
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { BASE_USDC_ADDRESS } from "@/lib/chain/config";
import { resetBlockscoutRateGate } from "@/lib/chain/blockscout";
import { invalidateWalletMetricsCache } from "@/lib/chain/wallet-metrics";
import { invalidatePayeeScoreCache, scorePayeeWallet } from "@/lib/scoring/payee-engine";

const WALLETS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
] as Address[];
const COLD_WALLET = "0x4444444444444444444444444444444444444444" as Address;
const RPC_URL = "https://rpc.test.invalid";
const realFetch = globalThis.fetch;

const NATIVE_BALANCE = 900_000_000_000_000n; // 0.0009 ETH
const USDC_BALANCE = 4_000_000_000n; // 4,000 of the 5,000 USDC still there

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const v1Ok = (result: unknown) => json({ status: "1", message: "OK", result });
const v1RateLimited = () =>
  json(
    {
      message: "Too many requests. Increase limits now at https://dev.blockscout.com",
      result: null,
      status: "0",
    },
    429,
  );

/**
 * Same healthy-wallet shape as tests/payee-fail-closed.test.ts, parameterized
 * by address: 200 days old, 121 non-self transactions, paid 5,000 USDC and
 * still holding 4,000 of it (drain ratio 0.2 — nowhere near the 0.8 line).
 */
const now = Math.floor(Date.now() / 1000);
function v1History(addr: string) {
  return [
    {
      hash: "0x1",
      from: "0x000000000000000000000000000000000000dead",
      to: addr,
      value: "1000000000000000",
      timeStamp: String(now - 200 * 86_400),
      blockNumber: "1",
      isError: "0",
    },
    ...Array.from({ length: 120 }, (_, i) => ({
      hash: `0x${i + 2}`,
      from: addr,
      to: "0x000000000000000000000000000000000000beef",
      value: "0",
      timeStamp: String(now - (190 - i) * 86_400),
      blockNumber: String(i + 2),
      isError: "0",
    })),
  ];
}
/** The v2 `/addresses/{a}/transactions` rendering of the same history, newest first. */
function v2History(addr: string) {
  return [...v1History(addr)].reverse().map((tx) => ({
    hash: tx.hash,
    block_number: Number(tx.blockNumber),
    timestamp: new Date(Number(tx.timeStamp) * 1000).toISOString(),
    value: tx.value,
    from: { hash: tx.from },
    to: { hash: tx.to },
  }));
}
/** v2 `/addresses/{a}/token-transfers?token=USDC` items, newest first. */
function v2UsdcTransfers(addr: string) {
  return [
    {
      transaction_hash: "0xb",
      block_number: 600,
      timestamp: new Date((now - 10 * 86_400) * 1000).toISOString(),
      from: { hash: addr },
      to: { hash: "0x000000000000000000000000000000000000feed" },
      total: { decimals: "6", value: "1000000000" }, // paid out 1,000 USDC
      token: { address_hash: BASE_USDC_ADDRESS },
    },
    {
      transaction_hash: "0xa",
      block_number: 500,
      timestamp: new Date((now - 30 * 86_400) * 1000).toISOString(),
      from: { hash: "0x000000000000000000000000000000000000cafe" },
      to: { hash: addr },
      total: { decimals: "6", value: "5000000000" }, // received 5,000 USDC
      token: { address_hash: BASE_USDC_ADDRESS },
    },
  ];
}

type StubOpts = {
  /** Answer each distinct v2 URL with one 500 before serving it — the
   *  measured intermittent-flake shape. */
  v2FlakyOnce?: boolean;
  /** Serve the cold-start shape: empty histories everywhere, zero balances,
   *  a zero v2 counter. Measured 2026-08-13: a never-indexed address gets
   *  200 {"items":[]} from the v2 transfer lists, not a 404. */
  cold?: boolean;
};

/**
 * The production weather this file exists for: v1 answers NOTHING but the
 * ascending wallet-metrics walk — every other v1 read draws the measured 429
 * penalty-box refusal. v2 and the RPC answer normally (modulo opts).
 */
function installUpstream(opts: StubOpts = {}) {
  const failedOnce = new Set<string>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    // --- RPC (drain balances) ---
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
            ? `0x${(opts.cold ? 0n : NATIVE_BALANCE).toString(16)}`
            : call.method === "eth_call"
              ? `0x${(opts.cold ? 0n : USDC_BALANCE).toString(16).padStart(64, "0")}`
              : "0x0",
      }));
      return json(Array.isArray(body) ? reply : reply[0]);
    }

    // --- Blockscout v2 (counters for metrics, transfer lists for drain) ---
    if (url.includes("/api/v2/addresses/")) {
      if (opts.v2FlakyOnce && !failedOnce.has(url)) {
        failedOnce.add(url);
        return new Response("Internal server error", { status: 500 });
      }
      const addr = (url.match(/addresses\/(0x[0-9a-fA-F]{40})/)?.[1] ?? "").toLowerCase();
      if (url.includes("/counters")) {
        return json({ transactions_count: opts.cold ? "0" : "121" });
      }
      if (url.includes("/token-transfers")) {
        return json({ items: opts.cold ? [] : v2UsdcTransfers(addr), next_page_params: null });
      }
      if (url.includes("/transactions")) {
        return json({ items: opts.cold ? [] : v2History(addr), next_page_params: null });
      }
      throw new Error(`unstubbed v2 call: ${url}`);
    }

    // --- Blockscout v1: the walk answers, everything else is the 429 wall ---
    if (url.includes("/api?")) {
      const params = new URL(url).searchParams;
      const addr = (params.get("address") ?? "").toLowerCase();
      if (params.get("action") === "txlist" && params.get("sort") === "asc") {
        if (opts.cold) return v1Ok([]);
        return v1Ok(params.get("page") === "1" ? v1History(addr) : []);
      }
      return v1RateLimited();
    }

    throw new Error(`unstubbed upstream call: ${url}`);
  }) as typeof fetch;
}

function freshCaches() {
  invalidatePayeeScoreCache();
  for (const w of [...WALLETS, COLD_WALLET]) invalidateWalletMetricsCache(w);
  resetBlockscoutRateGate();
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
  delete process.env.BASE_RPC_URL;
});

test("back-to-back scores stay clean while v1 serves nothing but the history walk", async () => {
  // The measured production state: every v1 read except the (grudgingly
  // allowed) ascending walk draws 429. The drain check must not care, and
  // scoring several distinct wallets in a row must not degrade any of them.
  installUpstream();
  for (const wallet of WALLETS) {
    const result = await scorePayeeWallet(wallet);
    assert.deepEqual(result.signals.flags, [], `${wallet} flagged: ${result.signals.flags}`);
    assert.equal(result.degraded, false, `${wallet} came back degraded`);
    // The numbers prove the v2 reads were actually parsed, not silently
    // empty. incomingCount is the USDC funding alone: the native funding tx
    // is the 121st-newest and the window is exactly the newest 100 — the same
    // truncation the v1 `offset: 100` read always had.
    assert.equal(result.signals.drainPattern.detected, false);
    assert.equal(result.signals.drainPattern.drainRatio, 0.2);
    assert.equal(result.signals.drainPattern.incomingCount, 1);
    assert.equal(result.signals.drainPattern.outgoingCount, 1);
  }
});

test("a single flaky v2 500 is retried, not failed closed on", async () => {
  installUpstream({ v2FlakyOnce: true });
  const result = await scorePayeeWallet(WALLETS[0]!);
  assert.deepEqual(result.signals.flags, []);
  assert.equal(result.degraded, false);
  assert.equal(result.signals.drainPattern.drainRatio, 0.2);
});

test("a cold-start payee is an empty history, not an outage", async () => {
  // x402 payees start as never-indexed addresses. Measured: the v2 transfer
  // lists answer 200 {"items":[]} for one, so the drain check must come back
  // as a real (neutral) reading — the wallet may still score poorly as a
  // burner, but through measurement, never through a manufactured outage.
  installUpstream({ cold: true });
  const result = await scorePayeeWallet(COLD_WALLET);
  const unavailable = result.signals.flags.filter((f) => f.endsWith("_unavailable"));
  assert.deepEqual(unavailable, [], `a cold start must not read as an outage: ${unavailable}`);
  assert.equal(result.degraded, false);
  assert.equal(result.signals.drainPattern.incomingCount, 0);
  assert.equal(result.signals.drainPattern.drainRatio, null);
});
