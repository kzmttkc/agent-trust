// ============================================================
// vet402 2026-08-13 — proof of control for an x402 write-back.
//
// The defect (HIGH-1, measured in production): POST /v1/payments/x402 took
// `wallet` as a bare claim in the request body. It confirmed the tx was real
// and originated from `wallet`, but never that the POSTER controls `wallet`.
// So any API key could take a STRANGER's real Base transfer — a known-scam
// wallet's, even — and post it as that stranger's settlement history, moving a
// third party's score. The fix is the same proof-of-control gate verified
// payees use: a valid EIP-191 signature by `wallet` over a tx-specific message.
//
// These test the pure signing/verification surface with a real key, so the
// crypto is exercised, not mocked.
//
// Run: npm test
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { x402AttestationMessage, verifyX402Ownership } from "@/lib/chain/x402-verify";

// A throwaway key — fixed so the test is deterministic. NOT a real wallet.
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(PK);
const WALLET = account.address;
const OTHER = "0x1111111111111111111111111111111111111111";
const TX = "0x" + "ab".repeat(32);
const OTHER_TX = "0x" + "cd".repeat(32);

// ---- the canonical message -------------------------------------------------

test("the attestation message is a fixed 4 lines binding wallet and tx, lowercased", () => {
  const msg = x402AttestationMessage(WALLET, TX);
  const lines = msg.split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "Vouch x402 settlement attestation");
  assert.equal(lines[1], `wallet: ${WALLET.toLowerCase()}`);
  assert.equal(lines[2], `tx: ${TX.toLowerCase()}`);
  // case-insensitive inputs produce the identical signed text
  assert.equal(x402AttestationMessage(WALLET.toUpperCase().replace("0X", "0x"), TX.toUpperCase().replace("0X", "0x")), msg);
});

// ---- verification ----------------------------------------------------------

test("a valid signature by the wallet proves ownership", async () => {
  const signature = await account.signMessage({ message: x402AttestationMessage(WALLET, TX) });
  assert.equal(await verifyX402Ownership(WALLET, TX, signature), true);
});

test("no signature is not ownership (recorded, never scored)", async () => {
  assert.equal(await verifyX402Ownership(WALLET, TX, undefined), false);
  assert.equal(await verifyX402Ownership(WALLET, TX, null), false);
  assert.equal(await verifyX402Ownership(WALLET, TX, ""), false);
});

test("a signature over a DIFFERENT tx does not authorize this write-back (no replay)", async () => {
  const forOtherTx = await account.signMessage({ message: x402AttestationMessage(WALLET, OTHER_TX) });
  assert.equal(await verifyX402Ownership(WALLET, TX, forOtherTx), false);
  // …and it still verifies for the tx it was actually signed for.
  assert.equal(await verifyX402Ownership(WALLET, OTHER_TX, forOtherTx), true);
});

test("a valid signature by the wallet cannot vouch for a DIFFERENT wallet", async () => {
  // The core HIGH-1 case: I control WALLET and sign for it, but claim OTHER.
  const signature = await account.signMessage({ message: x402AttestationMessage(WALLET, TX) });
  assert.equal(await verifyX402Ownership(OTHER, TX, signature), false);
});

test("garbage in the signature field is false, never a throw", async () => {
  assert.equal(await verifyX402Ownership(WALLET, TX, "0xnot-a-signature"), false);
  assert.equal(await verifyX402Ownership(WALLET, TX, "definitely not hex"), false);
});
