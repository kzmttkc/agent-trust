import { test } from "node:test";
import assert from "node:assert/strict";
import { parseObservatorySearchParams } from "@/lib/observatory/query";

test("defaults are page 1, pageSize 40, no filters", () => {
  assert.deepEqual(parseObservatorySearchParams({}), {
    page: 1,
    pageSize: 40,
    q: null,
    verdict: null,
    network: null,
  });
});

test("page is clamped to a positive integer", () => {
  assert.equal(parseObservatorySearchParams({ page: "0" }).page, 1);
  assert.equal(parseObservatorySearchParams({ page: "-3" }).page, 1);
  assert.equal(parseObservatorySearchParams({ page: "2.9" }).page, 2);
  assert.equal(parseObservatorySearchParams({ page: "nope" }).page, 1);
});

test("q is trimmed, wildcard-stripped, and dropped when empty", () => {
  assert.equal(parseObservatorySearchParams({ q: "  foo.example/api  " }).q, "foo.example/api");
  assert.equal(parseObservatorySearchParams({ q: "%_" }).q, null);
  assert.equal(parseObservatorySearchParams({ q: "   " }).q, null);
});

test("verdict only accepts the closed vocabulary", () => {
  assert.equal(parseObservatorySearchParams({ verdict: "pass" }).verdict, "pass");
  assert.equal(parseObservatorySearchParams({ verdict: "fail" }).verdict, "fail");
  assert.equal(parseObservatorySearchParams({ verdict: "unverified" }).verdict, "unverified");
  assert.equal(parseObservatorySearchParams({ verdict: "ALLOW" }).verdict, null);
});

test("network is a short token, not a query fragment", () => {
  assert.equal(parseObservatorySearchParams({ network: "eip155:8453" }).network, "eip155:8453");
  assert.equal(parseObservatorySearchParams({ network: "base'; drop" }).network, null);
});
