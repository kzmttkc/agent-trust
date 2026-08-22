// ============================================================
// vet402 Observatory L1 — x402 payer (design §1 L1, W3).
//
// This module SIGNS MONEY. The invariants under test are the ones that keep
// a hostile seller from turning a $0.001 probe into a drain:
//
//  - only scheme `exact` + EIP-3009 on Base, only canonical Base USDC —
//    an accepts[] naming any other asset/network/scheme is not an option,
//    it is a skip;
//  - the amount signed must equal the amount the CATALOG declared when we
//    selected the target (a challenge asking for more than advertised is
//    recorded as price_mismatch, never paid);
//  - a hard per-purchase ceiling holds even if catalog and challenge agree;
//  - authorization is short-lived (validBefore) with a random 32-byte nonce;
//  - v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) transports both spoken,
//    chosen by what the server's 402 actually is, not by assumption.
// Spec: coinbase/x402 specs/schemes/exact/scheme_exact_evm.md +
//       specs/transports-v2/http.md (fetched 2026-08-14).
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import {
  parseChallenge,
  selectAccept,
  buildAuthorization,
  signX402Payment,
  encodePaymentHeader,
  BASE_USDC,
  MAX_PER_PURCHASE_UNITS,
} from "@/lib/observatory/x402-payer";

// Well-known throwaway test key (anvil #0) — never funded on mainnet by us.
const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const account = privateKeyToAccount(TEST_PK);

const V2_ACCEPT = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "3000",
  asset: BASE_USDC,
  payTo: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};

// ---- parseChallenge --------------------------------------------------------

test("parseChallenge reads a v2 JSON body challenge", () => {
  const parsed = parseChallenge({
    bodyText: JSON.stringify({ x402Version: 2, accepts: [V2_ACCEPT] }),
    headers: new Headers(),
  });
  assert.equal(parsed?.x402Version, 2);
  assert.equal(parsed?.accepts.length, 1);
  assert.equal(parsed?.accepts[0].amount, "3000");
});

test("parseChallenge reads a v1 body and normalizes maxAmountRequired/network", () => {
  const parsed = parseChallenge({
    bodyText: JSON.stringify({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "base",
          maxAmountRequired: "5000",
          asset: BASE_USDC,
          payTo: V2_ACCEPT.payTo,
          maxTimeoutSeconds: 60,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    }),
    headers: new Headers(),
  });
  assert.equal(parsed?.x402Version, 1);
  assert.equal(parsed?.accepts[0].amount, "5000");
  assert.equal(parsed?.accepts[0].network, "eip155:8453", "v1 'base' normalizes to CAIP-2");
});

test("parseChallenge reads the v2 PAYMENT-REQUIRED header when the body is empty", () => {
  const required = { x402Version: 2, accepts: [V2_ACCEPT] };
  const headers = new Headers({
    "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(required)).toString("base64"),
  });
  const parsed = parseChallenge({ bodyText: "", headers });
  assert.equal(parsed?.accepts[0].payTo, V2_ACCEPT.payTo);
});

test("parseChallenge returns null on garbage", () => {
  assert.equal(parseChallenge({ bodyText: "<html>", headers: new Headers() }), null);
});

// ---- selectAccept (the money gate) ----------------------------------------

test("selectAccept picks the Base-USDC exact accept matching the catalog price", () => {
  const chosen = selectAccept([V2_ACCEPT], { declaredAmount: "3000", declaredPayTo: null });
  assert.ok(chosen.accept);
  assert.equal(chosen.accept!.amount, "3000");
});

test("selectAccept refuses any non-USDC asset — a scam token is a skip, not a payment", () => {
  const evil = { ...V2_ACCEPT, asset: "0x000000000000000000000000000000000000dEaD" };
  const chosen = selectAccept([evil], { declaredAmount: "3000", declaredPayTo: null });
  assert.equal(chosen.accept, null);
  assert.equal(chosen.reason, "no_eligible_accept");
});

test("selectAccept refuses non-Base networks and non-exact schemes", () => {
  assert.equal(
    selectAccept([{ ...V2_ACCEPT, network: "eip155:1" }], { declaredAmount: "3000", declaredPayTo: null }).accept,
    null,
  );
  assert.equal(
    selectAccept([{ ...V2_ACCEPT, scheme: "upto" }], { declaredAmount: "3000", declaredPayTo: null }).accept,
    null,
  );
  // batch-settlement etc. also excluded even on Base/USDC
  assert.equal(
    selectAccept([{ ...V2_ACCEPT, scheme: "batch-settlement" }], { declaredAmount: "3000", declaredPayTo: null })
      .accept,
    null,
  );
});

test("selectAccept refuses a challenge amount that contradicts the catalog declaration", () => {
  const chosen = selectAccept([{ ...V2_ACCEPT, amount: "999999" }], { declaredAmount: "3000", declaredPayTo: null });
  assert.equal(chosen.accept, null);
  assert.equal(chosen.reason, "price_mismatch");
});

test("selectAccept enforces the hard per-purchase ceiling even when catalog agrees", () => {
  const big = String(MAX_PER_PURCHASE_UNITS + 1n);
  const chosen = selectAccept([{ ...V2_ACCEPT, amount: big }], { declaredAmount: big, declaredPayTo: null });
  assert.equal(chosen.accept, null);
  assert.equal(chosen.reason, "over_cap");
});

test("selectAccept: price mismatch AND every accept over cap reports over_cap (the ceiling wins)", () => {
  // The challenge contradicts the catalog price (would be price_mismatch) but
  // every eligible accept is also above the hard ceiling. The more actionable
  // fact is that nothing was payable at all — so the reason is over_cap, not
  // price_mismatch. This is the allOverCap sub-branch.
  const big = String(MAX_PER_PURCHASE_UNITS + 5n);
  const chosen = selectAccept([{ ...V2_ACCEPT, amount: big }], { declaredAmount: "3000", declaredPayTo: null });
  assert.equal(chosen.accept, null);
  assert.equal(chosen.reason, "over_cap");
});

test("selectAccept without a declared catalog price still enforces the ceiling", () => {
  const ok = selectAccept([V2_ACCEPT], { declaredAmount: null, declaredPayTo: null });
  assert.ok(ok.accept, "no declaration → ceiling is the only price gate");
  const big = selectAccept([{ ...V2_ACCEPT, amount: String(MAX_PER_PURCHASE_UNITS + 1n) }], {
    declaredAmount: null,
    declaredPayTo: null,
  });
  assert.equal(big.accept, null);
});

test("selectAccept skips permit2-only accepts (eip3009 or unspecified only)", () => {
  const permit2 = {
    ...V2_ACCEPT,
    extra: { ...V2_ACCEPT.extra, assetTransferMethod: "permit2" },
  };
  assert.equal(selectAccept([permit2], { declaredAmount: "3000", declaredPayTo: null }).accept, null);
  const eip3009 = {
    ...V2_ACCEPT,
    extra: { ...V2_ACCEPT.extra, assetTransferMethod: "eip3009" },
  };
  assert.ok(selectAccept([eip3009], { declaredAmount: "3000", declaredPayTo: null }).accept);
});

// ---- selectAccept: the payTo gate (2026-08-22 audit) -----------------------
//
// l1-runner signs EIP-3009 with `to: accept.payTo` — the address the WALL
// returns, not the one the catalog advertised. Until this gate existed the EVM
// path never compared the two (Solana already did), so a seller could be paid
// at any address it liked, and the operator self-exclusion in candidate
// selection (which filters only the catalog's e.pay_to) could not see it.

const OTHER_PAYTO = "0x1111111111111111111111111111111111111111";

test("selectAccept refuses a wall payTo that contradicts the catalog declaration", () => {
  const chosen = selectAccept([V2_ACCEPT], {
    declaredAmount: "3000",
    declaredPayTo: OTHER_PAYTO,
  });
  assert.equal(chosen.accept, null);
  assert.equal(chosen.reason, "payto_mismatch");
});

test("payTo comparison is case-insensitive (checksummed vs lowercase are the same payee)", () => {
  const chosen = selectAccept([V2_ACCEPT], {
    declaredAmount: "3000",
    declaredPayTo: V2_ACCEPT.payTo.toLowerCase(),
  });
  assert.ok(chosen.accept, "同じアドレスの表記違いで拒否してはいけない");
  assert.equal(chosen.accept!.payTo, V2_ACCEPT.payTo, "署名の宛先は壁が言った表記のまま");
});

test("a catalog with no declared payTo passes through (nothing to contradict)", () => {
  const chosen = selectAccept([V2_ACCEPT], { declaredAmount: "3000", declaredPayTo: null });
  assert.ok(chosen.accept);
});

test("payto_mismatch is reported ahead of price_mismatch — whom we pay is the graver finding", () => {
  const chosen = selectAccept([{ ...V2_ACCEPT, amount: "999999" }], {
    declaredAmount: "3000",
    declaredPayTo: OTHER_PAYTO,
  });
  assert.equal(chosen.reason, "payto_mismatch");
});

test("the matching payee is selected even when another accept names a different one", () => {
  const chosen = selectAccept(
    [{ ...V2_ACCEPT, payTo: OTHER_PAYTO }, V2_ACCEPT],
    { declaredAmount: "3000", declaredPayTo: V2_ACCEPT.payTo },
  );
  assert.ok(chosen.accept);
  assert.equal(chosen.accept!.payTo, V2_ACCEPT.payTo);
});

test("a protocol-ineligible challenge is still no_eligible_accept, not payto_mismatch", () => {
  // 資産が違う時点で「受取先が違う」以前の話——所見を取り違えない。
  const chosen = selectAccept(
    [{ ...V2_ACCEPT, asset: "0x000000000000000000000000000000000000dEaD" }],
    { declaredAmount: "3000", declaredPayTo: OTHER_PAYTO },
  );
  assert.equal(chosen.reason, "no_eligible_accept");
});

// ---- authorization + signature --------------------------------------------

test("buildAuthorization: short validity window and unique random 32-byte nonces", () => {
  const now = 1_755_000_000;
  const a = buildAuthorization({ from: account.address, to: V2_ACCEPT.payTo, value: "3000", nowSec: now, maxTimeoutSeconds: 300 });
  assert.equal(a.from, account.address);
  assert.equal(a.value, "3000");
  assert.ok(Number(a.validAfter) <= now, "valid immediately (clock-skew slack)");
  assert.ok(Number(a.validBefore) <= now + 600, "never longer than 10 minutes");
  assert.ok(Number(a.validBefore) > now);
  assert.match(a.nonce, /^0x[0-9a-f]{64}$/);
  const b = buildAuthorization({ from: account.address, to: V2_ACCEPT.payTo, value: "3000", nowSec: now, maxTimeoutSeconds: 300 });
  assert.notEqual(a.nonce, b.nonce);
});

test("signX402Payment produces an EIP-3009 signature that recovers to our wallet", async () => {
  const authorization = buildAuthorization({
    from: account.address,
    to: V2_ACCEPT.payTo,
    value: "3000",
    nowSec: Math.floor(1_755_000_000),
    maxTimeoutSeconds: 300,
  });
  const { signature } = await signX402Payment({ account, accept: V2_ACCEPT, authorization });

  const valid = await verifyTypedData({
    address: account.address,
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 8453,
      verifyingContract: BASE_USDC as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as `0x${string}`,
      to: authorization.to as `0x${string}`,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce as `0x${string}`,
    },
    signature: signature as `0x${string}`,
  });
  assert.equal(valid, true);
});

// ---- transport encoding ----------------------------------------------------

test("encodePaymentHeader speaks v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) by challenge version", () => {
  const authorization = buildAuthorization({
    from: account.address,
    to: V2_ACCEPT.payTo,
    value: "3000",
    nowSec: 1_755_000_000,
    maxTimeoutSeconds: 300,
  });
  const payload = { signature: "0xabc", authorization };

  const v2 = encodePaymentHeader({ x402Version: 2, accept: V2_ACCEPT, payload, resourceUrl: "https://svc.example/api" });
  assert.equal(v2.headerName, "PAYMENT-SIGNATURE");
  const decoded2 = JSON.parse(Buffer.from(v2.headerValue, "base64").toString());
  assert.equal(decoded2.x402Version, 2);
  assert.equal(decoded2.accepted.scheme, "exact");
  assert.equal(decoded2.payload.authorization.value, "3000");

  const v1 = encodePaymentHeader({ x402Version: 1, accept: { ...V2_ACCEPT, network: "eip155:8453" }, payload, resourceUrl: "https://svc.example/api" });
  assert.equal(v1.headerName, "X-PAYMENT");
  const decoded1 = JSON.parse(Buffer.from(v1.headerValue, "base64").toString());
  assert.equal(decoded1.x402Version, 1);
  assert.equal(decoded1.network, "base", "v1 uses the short network slug");
  assert.equal(decoded1.scheme, "exact");
});
