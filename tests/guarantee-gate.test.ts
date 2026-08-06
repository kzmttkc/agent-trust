// ============================================================
// Vouch — guarantee underwriting is a dormant, UNREACHABLE receptacle.
//
// N-20 wires the underwrite() math to an API endpoint so that go-live is a
// single config flip (GUARANTEE_UNDERWRITING_ENABLED=true) once Takeshi +
// counsel approve (AQ-016). Until then, offering a financial guarantee must be
// impossible to reach: the endpoint must 404 as if it did not exist, and the
// flag must be true ONLY when explicitly set to the string "true" — no
// implicit production carve-out, no truthy-coercion of "1"/"yes".
//
// This is the monetization-receptacle health check the R&D close-out asks for:
// prove the path to a paid guarantee is closed while the flag is off, without
// adding or enabling any payment integration.
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/guarantee/quote/route";
import { isGuaranteeUnderwritingEnabled } from "@/lib/config/env";

const FLAG = "GUARANTEE_UNDERWRITING_ENABLED";
const original = process.env[FLAG];

afterEach(() => {
  if (original === undefined) delete process.env[FLAG];
  else process.env[FLAG] = original;
});

function req() {
  return new NextRequest("https://vouch.test/api/v1/guarantee/quote");
}

test("flag is off unless explicitly set to the exact string 'true'", () => {
  delete process.env[FLAG];
  assert.equal(isGuaranteeUnderwritingEnabled(), false, "unset → off");
  for (const v of ["false", "1", "yes", "TRUE", "on", ""]) {
    process.env[FLAG] = v;
    assert.equal(isGuaranteeUnderwritingEnabled(), false, `'${v}' must not enable underwriting`);
  }
  process.env[FLAG] = "true";
  assert.equal(isGuaranteeUnderwritingEnabled(), true);
});

test("quote endpoint 404s when the flag is off — no quote, before auth even runs", async () => {
  delete process.env[FLAG];
  const res = await GET(req());
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "not_found");
  assert.equal(body.canOffer, undefined, "a disabled feature reveals nothing about pricing");
});

test("with the flag on, the gate no longer 404s — only the flag gates reachability", async () => {
  process.env[FLAG] = "true";
  // No Authorization header → the request now reaches auth and is rejected
  // there (401), NOT 404. That proves the 404 above is the feature flag doing
  // its job, not an incidental missing route.
  const res = await GET(req());
  assert.notEqual(res.status, 404, "flag on: the endpoint exists and is reached");
  assert.equal(res.status, 401, "and then fails on missing auth, as any gated endpoint should");
});
