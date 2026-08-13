// ============================================================
// vet402 — the embeddable badge must not lie to a human (H-1 / H-5).
//
// R4 downstream/TOCTOU round. The public "Verified payee" badge went GREEN
// on nothing but a self-signed message (POST /v1/payees/verify): a BLOCK-
// scored, actively-draining wallet could sign a one-line message and paste a
// vet402 "Verified" badge onto a phishing page. Green must therefore be
// earned by BOTH facts a human reads into it: ownership was proven (a signed
// claim exists) AND the live judgment is a clean ALLOW. A BLOCK verdict is a
// revocation — the badge must actively say "Flagged", never green (H-5). Any
// state where trust cannot be established (WARN, a degraded read, or a failed
// score lookup) is fail-closed to "Caution", never green.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBadgeState, renderBadgeSvg } from "@/lib/badge/trust-badge";

const GREEN = "#059669";

test("unsigned wallet is Unverified regardless of a good score", () => {
  const s = resolveBadgeState({ signed: false, recommendation: "ALLOW", subject: "payee" });
  assert.equal(s.state, "unverified");
  assert.equal(s.label, "Unverified");
  assert.notEqual(s.color, GREEN);
});

test("signed + clean ALLOW is the only path to green Verified payee", () => {
  const s = resolveBadgeState({ signed: true, recommendation: "ALLOW", subject: "payee" });
  assert.equal(s.state, "verified");
  assert.equal(s.label, "Verified payee");
  assert.equal(s.color, GREEN);
});

test("signed agent + clean ALLOW reads Verified agent", () => {
  const s = resolveBadgeState({ signed: true, recommendation: "ALLOW", subject: "agent" });
  assert.equal(s.state, "verified");
  assert.equal(s.label, "Verified agent");
  assert.equal(s.color, GREEN);
});

test("H-5 revocation: a signed wallet that turns BLOCK shows Flagged, never green", () => {
  const s = resolveBadgeState({ signed: true, recommendation: "BLOCK", subject: "payee" });
  assert.equal(s.state, "flagged");
  assert.equal(s.label, "Flagged");
  assert.notEqual(s.color, GREEN);
});

test("H-1 attack: BLOCK wallet cannot mint a green badge by signing", () => {
  // The exact exploit: self-attest, then embed. The signature is real, the
  // trust is not — the badge must not be green.
  const signed = resolveBadgeState({ signed: true, recommendation: "BLOCK", subject: "payee" });
  assert.notEqual(signed.color, GREEN);
  assert.notEqual(signed.state, "verified");
});

test("signed + WARN is Caution, not green (BLOCK/WARN never green)", () => {
  const s = resolveBadgeState({ signed: true, recommendation: "WARN", subject: "payee" });
  assert.equal(s.state, "caution");
  assert.equal(s.label, "Caution");
  assert.notEqual(s.color, GREEN);
});

test("fail-closed: a signed wallet whose score lookup failed is never green", () => {
  const s = resolveBadgeState({ signed: true, recommendation: null, subject: "payee" });
  assert.equal(s.state, "caution");
  assert.notEqual(s.color, GREEN);
});

test("fail-closed: a degraded read cannot produce green even on an ALLOW band", () => {
  // degraded means the score is a fail-closed refusal, not a measurement —
  // it must never be promoted to green even if `recommendation` came through.
  const s = resolveBadgeState({
    signed: true,
    recommendation: "ALLOW",
    degraded: true,
    subject: "payee",
  });
  assert.notEqual(s.color, GREEN);
  assert.equal(s.state, "caution");
});

test("rendered SVG uses green fill only for a verified state", () => {
  const green = renderBadgeSvg(
    resolveBadgeState({ signed: true, recommendation: "ALLOW", subject: "payee" }),
  );
  assert.match(green, new RegExp(GREEN));
  assert.match(green, /Verified payee/);

  const flagged = renderBadgeSvg(
    resolveBadgeState({ signed: true, recommendation: "BLOCK", subject: "payee" }),
  );
  assert.doesNotMatch(flagged, new RegExp(GREEN));
  assert.match(flagged, /Flagged/);

  const caution = renderBadgeSvg(
    resolveBadgeState({ signed: true, recommendation: "WARN", subject: "payee" }),
  );
  assert.doesNotMatch(caution, new RegExp(GREEN));
});

test("rendered SVG is well-formed and stays 156px wide", () => {
  const svg = renderBadgeSvg(
    resolveBadgeState({ signed: false, recommendation: null, subject: "payee" }),
  );
  assert.match(svg, /^<svg xmlns=/);
  assert.match(svg, /width="156"/);
  assert.match(svg, /<title>/);
});

test("every state carries an aria description that says what green means", () => {
  // The human-misread fix lives partly in the accessible name: a screen
  // reader / hover must learn that green = ownership signed AND ALLOW, and
  // that the other states are not a trust guarantee.
  const green = resolveBadgeState({ signed: true, recommendation: "ALLOW", subject: "payee" });
  assert.match(green.aria, /Verified payee/);
  assert.match(green.aria, /ALLOW|trust/i);
  const caution = resolveBadgeState({ signed: true, recommendation: "WARN", subject: "payee" });
  assert.match(caution.aria, /not a trust guarantee|trust not established|ownership/i);
});
