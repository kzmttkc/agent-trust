// HTTP timeout contract (node:test, no framework — run with `npm test` after
// `npm run build`).
//
// 2026-08-22 (audit): `VouchClient.request` called `fetch` with no `signal`,
// and `fetch` has no timeout of its own. Every fail-closed rule in SpendGuard
// is downstream of a lookup that RETURNS — a server that accepts the
// connection and then never answers left `evaluate()` pending forever, which
// is neither an allow nor a deny. The judgement was fail-closed; the transport
// underneath it could still hang the agent's payment path indefinitely.
//
// These tests pin the two halves of the fix: the request is always bounded,
// and a bound that fires denies with the right reason code and returns the
// budget reservation.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVouchClient,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../dist/index.js";

const WALLET = "0x1111111111111111111111111111111111111111";

/** A server that accepts the request and never answers. Only the abort ends it. */
function hangingFetch() {
  const calls = [];
  const fetchFn = (url, init) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  };
  return { calls, fetchFn };
}

test("every request carries an abort signal, unaborted at call time", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const vouch = createVouchClient({ apiKey: "vouch_live_test", fetch: fetchFn });
  await vouch.getPayeeScore(WALLET);
  assert.ok(calls[0].init.signal, "no signal was passed to fetch");
  assert.equal(calls[0].init.signal.aborted, false);
});

test("the default timeout is 10s and matches the Python SDK", () => {
  // Deliberately NOT the middleware's 5s — see DEFAULT_REQUEST_TIMEOUT_MS for
  // the two measured reasons (the sibling Python SDK's 10.0s default, and the
  // score route's own maxDuration = 30 for a cold score).
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 10_000);
});

test("an upstream that never answers rejects instead of hanging", async () => {
  const { fetchFn } = hangingFetch();
  const vouch = createVouchClient({
    apiKey: "vouch_live_test",
    fetch: fetchFn,
    timeoutMs: 25,
  });
  await assert.rejects(
    () => vouch.getPayeeScore(WALLET),
    (err) => {
      // AbortSignal.timeout rejects with a DOMException named TimeoutError.
      assert.equal(err.name, "TimeoutError");
      return true;
    },
  );
});

test("a hung lookup denies the payment as payee_trust_unavailable", async () => {
  const { fetchFn } = hangingFetch();
  const vouch = createVouchClient({
    apiKey: "vouch_live_test",
    fetch: fetchFn,
    timeoutMs: 25,
  });
  const guard = vouch.createSpendGuard({ dailyBudgetUsd: 100 });

  const decision = await guard.evaluate({ payee: WALLET, amountUsd: 10 });

  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["payee_trust_unavailable"]);
  assert.equal(decision.payeeScore, null);
  // The optimistic reservation must come back: a payment denied because we
  // could not vet the payee never spent anything.
  assert.equal(guard.state().spentTodayUsd, 0);
  assert.equal(decision.remainingDailyBudgetUsd, 100);
});

test("a hung lookup denies under block-only too (not just allow-only)", async () => {
  const { fetchFn } = hangingFetch();
  const vouch = createVouchClient({
    apiKey: "vouch_live_test",
    fetch: fetchFn,
    timeoutMs: 25,
  });
  const guard = vouch.createSpendGuard({ trustPolicy: "block-only" });
  const decision = await guard.evaluate({ payee: WALLET, amountUsd: 5 });
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["payee_trust_unavailable"]);
});

test("a caller's stricter timeout is honoured", async () => {
  const { calls, fetchFn } = hangingFetch();
  const vouch = createVouchClient({
    apiKey: "vouch_live_test",
    fetch: fetchFn,
    timeoutMs: 20,
  });
  const started = Date.now();
  await assert.rejects(() => vouch.getPayeeScore(WALLET));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `abort took ${elapsed}ms — the 20ms bound did not fire`);
  assert.ok(calls[0].init.signal.aborted, "the signal was never aborted");
});

test("an invalid timeoutMs fails with a message that names the option", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createVouchClient({ apiKey: "k", timeoutMs: bad }),
      (err) => {
        assert.match(err.message, /invalid_timeout_ms/);
        assert.match(err.message, /timeoutMs/);
        return true;
      },
      `timeoutMs: ${bad} should have been rejected`,
    );
  }
});

test("attestation POSTs are bounded too, not just score reads", async () => {
  const { calls, fetchFn } = hangingFetch();
  const vouch = createVouchClient({
    apiKey: "vouch_live_test",
    fetch: fetchFn,
    timeoutMs: 25,
  });
  await assert.rejects(() =>
    vouch.attestX402Payment({ wallet: WALLET, txHash: `0x${"a".repeat(64)}` }),
  );
  assert.ok(calls[0].init.signal.aborted);
});
