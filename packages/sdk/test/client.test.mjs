// Construction contract for createVouchClient (node:test, no framework —
// run with `npm test` after `npm run build`).
//
// 2026-08-13 (hackathon persona R2): the most obvious first line a new
// integrator writes — `createVouchClient({ apiKey })` — threw a raw
//
//   TypeError: Cannot read properties of undefined (reading 'replace')
//       at dist/index.js:11
//
// A stack trace pointing into our compiled output, naming none of our
// options. There is exactly one URL that argument could sensibly default to,
// so it defaults to it now. Anything genuinely malformed still fails, but
// with a message that says what to pass.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createVouchClient, VouchApiError, DEFAULT_API_URL } from "../dist/index.js";

const WALLET = "0x1111111111111111111111111111111111111111";

function captureFetch(response) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return (
      response ??
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  };
  return { calls, fetchFn };
}

test("apiUrl defaults to the hosted production API", async () => {
  const { calls, fetchFn } = captureFetch();
  const vouch = createVouchClient({ apiKey: "vouch_live_test", fetch: fetchFn });
  await vouch.getWalletScore(WALLET);
  assert.equal(DEFAULT_API_URL, "https://vet402.com/api/v1");
  assert.equal(calls[0].url, `https://vet402.com/api/v1/wallets/${WALLET}/score`);
});

test("an explicit apiUrl still wins, trailing slash trimmed", async () => {
  const { calls, fetchFn } = captureFetch();
  const vouch = createVouchClient({
    apiUrl: "http://localhost:3000/api/v1/",
    apiKey: "vouch_live_test",
    fetch: fetchFn,
  });
  await vouch.getWalletScore(WALLET);
  assert.equal(calls[0].url, `http://localhost:3000/api/v1/wallets/${WALLET}/score`);
});

test("a blank apiUrl fails with a message that names the option", () => {
  assert.throws(() => createVouchClient({ apiUrl: "   ", apiKey: "k" }), (err) => {
    assert.match(err.message, /invalid_api_url/);
    assert.match(err.message, /apiUrl/);
    return true;
  });
});

test("a missing apiKey fails with a message that names the option", () => {
  assert.throws(() => createVouchClient({}), (err) => {
    assert.match(err.message, /invalid_api_key/);
    assert.match(err.message, /apiKey/);
    return true;
  });
});

test("a non-2xx answer throws VouchApiError carrying code and status", async () => {
  const { fetchFn } = captureFetch(
    new Response(JSON.stringify({ error: "missing_api_key" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
  const vouch = createVouchClient({ apiKey: "k", fetch: fetchFn });
  await assert.rejects(
    () => vouch.getWalletScore(WALLET),
    (err) => {
      assert.ok(err instanceof VouchApiError);
      assert.equal(err.code, "missing_api_key");
      assert.equal(err.status, 401);
      // message stays the bare code so pre-0.2.0 `err.message` checks hold.
      assert.equal(err.message, "missing_api_key");
      return true;
    },
  );
});
