// ============================================================
// Vouch — x402 settlement extraction and the declared-amount check.
//
// The defect this closes (found 2026-08-05, fixed the same day): the
// attestation endpoint verified the tx hash, the success status and the payer
// wallet — and then stored `amount` exactly as it arrived in the request body,
// unchecked, on a product whose whole proposition is that it verifies things.
// Worse, the wallet-match condition could be satisfied by a Transfer of ANY
// ERC20: a payer could move a token they minted themselves and have the row
// recorded as an x402 settlement.
//
// So the rules under test are:
//   - the settlement leg is a Base USDC Transfer, and nothing else counts;
//   - the amount is confirmed only when the caller declared one, the leg is
//     USDC, and the two integers are equal;
//   - anything else is amountVerified=false with the ON-CHAIN figure kept —
//     never a silent "true", and never an exception that would lose a real
//     settlement over bad metadata.
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDeclaredAmount,
  extractPayeeFromReceipt,
  extractSettlement,
  type ReceiptLike,
} from "@/lib/chain/x402-verify";
import { BASE_USDC_ADDRESS } from "@/lib/chain/config";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PAYER = "0x1111111111111111111111111111111111111111";
const MERCHANT = "0x2222222222222222222222222222222222222222";
const FEE_COLLECTOR = "0x3333333333333333333333333333333333333333";
const FAKE_TOKEN = "0x9999999999999999999999999999999999999999";
const USDC = BASE_USDC_ADDRESS.toLowerCase();

const topic = (addr: string) => `0x${"0".repeat(24)}${addr.slice(2)}`.toLowerCase();
const hexAmount = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;

function transferLog(opts: {
  token: string;
  from: string;
  to: string;
  amount: bigint;
}) {
  return {
    address: opts.token,
    topics: [TRANSFER_TOPIC, topic(opts.from), topic(opts.to)],
    data: hexAmount(opts.amount),
  };
}

function receipt(logs: ReceiptLike["logs"], to: string | null = MERCHANT): ReceiptLike {
  return { to, logs };
}

// ---- settlement extraction -------------------------------------------------

test("a single USDC leg is exact, and reports the token and amount", () => {
  const r = extractSettlement(
    receipt([transferLog({ token: USDC, from: PAYER, to: MERCHANT, amount: 1_000_000n })]),
    PAYER,
  );
  assert.equal(r.payee, MERCHANT);
  assert.equal(r.confidence, "exact");
  assert.equal(r.token, USDC);
  assert.equal(r.onChainAmount, "1000000");
  assert.equal(r.isUsdc, true);
});

test("a transfer of some other token is NOT usdc, even when everything else matches", () => {
  const r = extractSettlement(
    receipt([transferLog({ token: FAKE_TOKEN, from: PAYER, to: MERCHANT, amount: 999n })]),
    PAYER,
  );
  assert.equal(r.payee, MERCHANT, "the payee still resolves");
  assert.equal(r.token, FAKE_TOKEN);
  assert.equal(r.isUsdc, false, "a self-minted token must never read as settlement");
});

test("a fee split picks the largest USDC leg as the settlement body", () => {
  const r = extractSettlement(
    receipt([
      transferLog({ token: USDC, from: PAYER, to: FEE_COLLECTOR, amount: 50_000n }),
      transferLog({ token: USDC, from: PAYER, to: MERCHANT, amount: 950_000n }),
    ]),
    PAYER,
  );
  assert.equal(r.payee, MERCHANT);
  assert.equal(r.confidence, "ambiguous");
  assert.equal(r.onChainAmount, "950000");
  assert.equal(r.isUsdc, true);
});

test("a huge decoy in another token cannot outbid the real USDC leg", () => {
  // Without the USDC preference, the biggest raw number wins and the reported
  // settlement amount would be denominated in a token x402 does not settle in.
  const r = extractSettlement(
    receipt([
      transferLog({ token: FAKE_TOKEN, from: PAYER, to: FEE_COLLECTOR, amount: 10n ** 30n }),
      transferLog({ token: USDC, from: PAYER, to: MERCHANT, amount: 1_000_000n }),
    ]),
    PAYER,
  );
  assert.equal(r.payee, MERCHANT);
  assert.equal(r.token, USDC);
  assert.equal(r.onChainAmount, "1000000");
});

test("the relayer path (payer never appears as `from`) is a fallback", () => {
  const r = extractSettlement(
    receipt([
      transferLog({ token: USDC, from: FEE_COLLECTOR, to: MERCHANT, amount: 1_000_000n }),
    ]),
    PAYER,
  );
  assert.equal(r.payee, MERCHANT);
  assert.equal(r.confidence, "fallback");
  assert.equal(r.onChainAmount, "1000000");
});

test("a receipt with no Transfer logs falls back to receipt.to and reports no amount", () => {
  const r = extractSettlement(receipt([], MERCHANT), PAYER);
  assert.equal(r.payee, MERCHANT);
  assert.equal(r.confidence, "fallback");
  assert.equal(r.token, null);
  assert.equal(r.onChainAmount, null);
  assert.equal(r.isUsdc, false);
});

test("a contract creation with no logs and no `to` resolves to nothing", () => {
  const r = extractSettlement(receipt([], null), PAYER);
  assert.equal(r.payee, null);
  assert.equal(r.onChainAmount, null);
});

test("unparseable log data reads as 0 rather than throwing", () => {
  const log = transferLog({ token: USDC, from: PAYER, to: MERCHANT, amount: 1n });
  const r = extractSettlement(receipt([{ ...log, data: "not-hex" }]), PAYER);
  assert.equal(r.onChainAmount, "0");
});

test("the payee helper still returns exactly what it always did", () => {
  const r = extractPayeeFromReceipt(
    receipt([transferLog({ token: USDC, from: PAYER, to: MERCHANT, amount: 5n })]),
    PAYER,
  );
  assert.deepEqual(r, { payee: MERCHANT, confidence: "exact" });
});

test("addresses are compared case-insensitively", () => {
  const r = extractSettlement(
    receipt([transferLog({ token: USDC, from: PAYER, to: MERCHANT, amount: 7n })]),
    PAYER.toUpperCase().replace("0X", "0x"),
  );
  assert.equal(r.confidence, "exact");
});

// ---- the declared-amount check --------------------------------------------

const usdcLeg = { token: USDC, onChainAmount: "1000000", isUsdc: true };

test("no declared amount is null — unknown, not unverified", () => {
  assert.equal(checkDeclaredAmount(undefined, usdcLeg).amountVerified, null);
  assert.equal(checkDeclaredAmount(null, usdcLeg).amountVerified, null);
  assert.equal(checkDeclaredAmount("", usdcLeg).amountVerified, null);
});

test("an exact USDC match is the only path to true", () => {
  assert.equal(checkDeclaredAmount("1000000", usdcLeg).amountVerified, true);
});

test("an off-by-one declaration is not verified, and says both figures", () => {
  const r = checkDeclaredAmount("1000001", usdcLeg);
  assert.equal(r.amountVerified, false);
  assert.deepEqual(r.amountMismatch, { declared: "1000001", onChain: "1000000" });
});

test("the right number in the wrong token is not verified", () => {
  const r = checkDeclaredAmount("1000000", {
    token: FAKE_TOKEN,
    onChainAmount: "1000000",
    isUsdc: false,
  });
  assert.equal(r.amountVerified, false, "x402 settles in USDC — nothing else counts");
});

test("a declared amount with no readable settlement leg is not verified", () => {
  const r = checkDeclaredAmount("1000000", { token: null, onChainAmount: null, isUsdc: false });
  assert.equal(r.amountVerified, false);
  assert.deepEqual(r.amountMismatch, { declared: "1000000", onChain: null });
});

test("a non-numeric declared amount is rejected, not thrown on", () => {
  const r = checkDeclaredAmount("1.5 USDC", usdcLeg);
  assert.equal(r.amountVerified, false);
  assert.equal(r.amountMismatch?.declared, "1.5 USDC");
});

test("a decimal string is not treated as base units", () => {
  // "1.0" is not a uint256; accepting it would let 1.0 pass for 1 wei-unit.
  assert.equal(checkDeclaredAmount("1.0", { ...usdcLeg, onChainAmount: "1" }).amountVerified, false);
});

test("leading zeros and huge values still compare as integers", () => {
  assert.equal(checkDeclaredAmount("0001000000", usdcLeg).amountVerified, true);
  const big = (10n ** 30n).toString();
  assert.equal(
    checkDeclaredAmount(big, { token: USDC, onChainAmount: big, isUsdc: true }).amountVerified,
    true,
  );
});

test("zero declared against a zero-value transfer is a real match", () => {
  assert.equal(
    checkDeclaredAmount("0", { token: USDC, onChainAmount: "0", isUsdc: true }).amountVerified,
    true,
  );
});

test("the USDC address under test is the documented Base one", () => {
  assert.equal(BASE_USDC_ADDRESS, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
});
