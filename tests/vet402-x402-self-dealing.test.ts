// ============================================================
// vet402 2026-08-13 — hole 2: x402 self-dealing / dust must not manufacture a
// settlement history. main counted every score-eligible (USDC + amount- +
// owner-verified) row a wallet paid, with NO floor on amount and NO check that
// the recipient was independent. So an attacker paid DUST (0.000001 USDC) to
// wallets it funds itself and bought "20 settlements" → x402=85 → 82/ALLOW.
//
// getX402PaymentStats now counts a payment only when it is (SQL) non-dust and
// not a literal self-send, and (JS) went to an independently-funded recipient.
// The recipient-independence decision is pure (keepIndependentByFunder) and
// unit-tested here; the SQL floor + self-send filter are pinned against source,
// the same way tests/payee-fail-closed.test.ts pins getOutcomesForWallet.
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keepIndependentByFunder } from "@/lib/db/x402-payments";

type Row = { id: string; payee: string | null };
const row = (id: string, payee: string | null): Row => ({ id, payee });

const PAYER_FUNDER = "0xfunder_a";

// ---- recipient-independence decision (pure) --------------------------------

test("ATTACK: A→B where both are funded by the payer's own funder is dropped", () => {
  // The self-dealing loop: payer and payee share a funding source (the
  // attacker's funding wallet). Not independent → not a settlement.
  const payerFunders = new Set([PAYER_FUNDER]);
  const funderOfPayee = new Map([["0xsockpuppet", PAYER_FUNDER]]);
  const kept = keepIndependentByFunder(payerFunders, funderOfPayee, [row("p1", "0xsockpuppet")]);
  assert.deepEqual(kept, [], "a same-cluster recipient must not count");
});

test("a payment to an INDEPENDENTLY funded recipient is kept", () => {
  const payerFunders = new Set([PAYER_FUNDER]);
  const funderOfPayee = new Map([["0xrealcustomer", "0xfunder_z"]]);
  const kept = keepIndependentByFunder(payerFunders, funderOfPayee, [row("p1", "0xrealcustomer")]);
  assert.equal(kept.length, 1, "a genuinely independent recipient is real evidence");
});

test("an UNKNOWN funder degrades permissively — its own source, kept", () => {
  // Matches countDistinctFunders: the index is a sybil discount, not a
  // correctness gate. A recipient not yet in funder_wallets counts.
  const kept = keepIndependentByFunder(new Set([PAYER_FUNDER]), new Map(), [row("p1", "0xnewpayee")]);
  assert.equal(kept.length, 1);
});

test("a null payee never counts as evidence", () => {
  const kept = keepIndependentByFunder(new Set(), new Map(), [row("p1", null)]);
  assert.deepEqual(kept, []);
});

test("mixed batch: only the independently funded, non-sockpuppet recipients survive", () => {
  const payerFunders = new Set([PAYER_FUNDER]);
  const funderOfPayee = new Map<string, string>([
    ["0xsock1", PAYER_FUNDER], // same cluster → drop
    ["0xsock2", PAYER_FUNDER], // same cluster → drop
    ["0xreal", "0xfunder_z"], // independent → keep
    // 0xunknown absent from map → kept
  ]);
  const kept = keepIndependentByFunder(payerFunders, funderOfPayee, [
    row("p1", "0xsock1"),
    row("p2", "0xsock2"),
    row("p3", "0xreal"),
    row("p4", "0xunknown"),
  ]);
  assert.deepEqual(kept.map((r) => r.id).sort(), ["p3", "p4"]);
});

// ---- the SQL-level filters (source-pinned) ---------------------------------

const src = readFileSync(
  join(process.cwd(), "src", "lib", "db", "x402-payments.ts"),
  "utf8",
);
const statsFn = (() => {
  const start = src.indexOf("export async function getX402PaymentStats");
  return src.slice(start, src.indexOf("\nexport ", start + 1));
})();

test("getX402PaymentStats excludes literal self-sends (payee <> payer)", () => {
  assert.match(
    statsFn,
    /lower\(\$\{x402Payments\.payee\}\) <> \$\{walletLower\}/,
    "a wallet paying itself must not build a settlement history",
  );
});

test("getX402PaymentStats enforces a non-dust minimum amount", () => {
  assert.match(
    statsFn,
    /onchainAmount\}\)::numeric >= \$\{X402_MIN_SETTLEMENT_UNITS/,
    "dust settlements must be excluded from the count",
  );
  // The default floor strips the demonstrated 0.000001 USDC (1 base unit) loop
  // by orders of magnitude, while staying under a cent so real micropayments
  // still count.
  assert.match(src, /1_000n/, "default floor is 0.001 USDC in base units");
});

test("getX402PaymentStats routes rows through the independence filter", () => {
  assert.match(
    statsFn,
    /keepIndependentlyFundedRecipients\(db, walletLower, rows\)/,
    "the recipient-independence filter must be applied, not bypassed",
  );
});
