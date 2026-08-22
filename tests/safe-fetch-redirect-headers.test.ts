// ============================================================
// safeFetch — credentials must not cross an origin on a redirect.
//
// WHY (2026-08-22 audit). The L1 paid retry sends a signed EIP-3009
// authorization in `X-PAYMENT` (x402 v1) or `PAYMENT-SIGNATURE` (v2). Because
// safeFetch follows redirects MANUALLY (so the SSRF gate can re-run per hop),
// nothing was doing what undici would otherwise do for us: drop credentials
// when the hop changes origin. A seller answering 302 to a host it does not
// control therefore handed a third party a valid payment authorization.
//
// These tests fix the contract: cross-origin hop → credential headers gone;
// same-origin hop → request survives intact (the paid retry must still work
// through a trailing-slash 301).
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFetch } from "@/lib/net/safe-fetch";
import type { AddressResolver } from "@/lib/net/public-address";

/** Every hostname resolves to the same public address unless stated. */
const resolveAllPublic: AddressResolver = async () => [{ address: "93.184.216.34", family: 4 }];

/**
 * A fetch stub that records the headers of every hop and replays a scripted
 * list of responses. Returns the recorder so a test can inspect hop N.
 */
function scriptedFetch(script: Array<{ status: number; location?: string }>) {
  const hops: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    hops.push({ url, headers });
    const step = script[hops.length - 1] ?? { status: 200 };
    return new Response("", {
      status: step.status,
      headers: step.location ? { location: step.location } : {},
    });
  };
  return { hops, fetchImpl };
}

const CREDENTIALS = {
  authorization: "Bearer secret-token",
  cookie: "session=abc",
  "proxy-authorization": "Basic zzz",
  // The exact names encodePaymentHeader() emits (x402-payer.ts): v1 / v2.
  "x-payment": "eyJ4NDAyVmVyc2lvbiI6MX0=",
  "payment-signature": "eyJ4NDAyVmVyc2lvbiI6Mn0=",
};

test("cross-origin redirect drops every credential header, keeps the harmless ones", async () => {
  const { hops, fetchImpl } = scriptedFetch([
    { status: 302, location: "https://evil.example/collect" },
    { status: 200 },
  ]);

  await safeFetch(
    "https://seller.example/paid",
    {
      method: "GET",
      headers: { ...CREDENTIALS, accept: "application/json", "user-agent": "vet402-test/1.0" },
    },
    { fetchImpl, resolve: resolveAllPublic },
  );

  assert.equal(hops.length, 2);
  // Hop 1 is the seller we chose to pay: it still gets the authorization.
  assert.equal(hops[0].headers["x-payment"], CREDENTIALS["x-payment"]);
  assert.equal(hops[0].headers["payment-signature"], CREDENTIALS["payment-signature"]);

  // Hop 2 is a different origin: nothing that authorizes anything survives.
  for (const name of Object.keys(CREDENTIALS)) {
    assert.equal(
      hops[1].headers[name],
      undefined,
      `${name} must not reach a cross-origin redirect target`,
    );
  }
  // Non-credential headers are unaffected — this is not a general header wipe.
  assert.equal(hops[1].headers["accept"], "application/json");
  assert.equal(hops[1].headers["user-agent"], "vet402-test/1.0");
});

test("same-origin redirect keeps the payment header (a trailing-slash 301 must not break a paid retry)", async () => {
  const { hops, fetchImpl } = scriptedFetch([
    { status: 301, location: "https://seller.example/paid/" },
    { status: 200 },
  ]);

  await safeFetch(
    "https://seller.example/paid",
    { method: "GET", headers: { ...CREDENTIALS } },
    { fetchImpl, resolve: resolveAllPublic },
  );

  assert.equal(hops.length, 2);
  assert.equal(hops[1].headers["x-payment"], CREDENTIALS["x-payment"]);
  assert.equal(hops[1].headers["payment-signature"], CREDENTIALS["payment-signature"]);
  assert.equal(hops[1].headers["authorization"], CREDENTIALS.authorization);
});

test("scheme downgrade and port change count as crossing an origin", async () => {
  for (const location of [
    "http://seller.example/paid", // https -> http, same host: clear-text credential
    "https://seller.example:8443/paid", // same host, different port
    "https://api.seller.example/paid", // sibling subdomain is still another origin
  ]) {
    const { hops, fetchImpl } = scriptedFetch([{ status: 307, location }, { status: 200 }]);
    await safeFetch(
      "https://seller.example/paid",
      { method: "GET", headers: { ...CREDENTIALS } },
      { fetchImpl, resolve: resolveAllPublic },
    );
    assert.equal(hops[1].headers["x-payment"], undefined, `x-payment leaked to ${location}`);
    assert.equal(
      hops[1].headers["authorization"],
      undefined,
      `authorization leaked to ${location}`,
    );
  }
});

test("stripping survives a chain: credential gone at hop 2 stays gone when hop 3 returns to the origin", async () => {
  // A seller that bounces out and back must not get the authorization handed
  // back to it — once dropped, it is not reconstructed.
  const { hops, fetchImpl } = scriptedFetch([
    { status: 302, location: "https://relay.example/a" },
    { status: 302, location: "https://seller.example/paid" },
    { status: 200 },
  ]);

  await safeFetch(
    "https://seller.example/paid",
    { method: "GET", headers: { ...CREDENTIALS } },
    { fetchImpl, resolve: resolveAllPublic },
  );

  assert.equal(hops.length, 3);
  assert.equal(hops[1].headers["x-payment"], undefined);
  assert.equal(hops[2].headers["x-payment"], undefined);
});

test("the caller's own init.headers object is not mutated by stripping", async () => {
  const { fetchImpl } = scriptedFetch([
    { status: 302, location: "https://evil.example/collect" },
    { status: 200 },
  ]);
  const callerHeaders = { ...CREDENTIALS };
  await safeFetch(
    "https://seller.example/paid",
    { method: "GET", headers: callerHeaders },
    { fetchImpl, resolve: resolveAllPublic },
  );
  assert.equal(callerHeaders["x-payment"], CREDENTIALS["x-payment"]);
});
