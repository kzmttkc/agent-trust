// ============================================================
// Vouch — agent passport (A-10): canonical message + signature round-trip.
//
// The passport is the symmetric twin of the verified payee. These guard the
// same invariants the payee route guards, for the agent side:
//   1. The signed message is a FIXED 5 lines. A `name` carrying a newline/CR/
//      tab would forge extra lines (e.g. a second "wallet:" or "agentId:"),
//      so a non-canonical name must be refused by agentPassportMessage itself.
//   2. The signature scheme actually verifies end-to-end (EIP-191 via viem),
//      and a tampered field breaks it — this is what makes the passport
//      third-party-verifiable without trusting our server.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { verifyMessage } from "viem";
import { agentPassportMessage } from "@/lib/verify-message";

test("agentPassportMessage produces the documented 5-line canonical message", () => {
  const msg = agentPassportMessage(42n, "0xAbC0000000000000000000000000000000000001", "Acme Agent");
  assert.equal(
    msg,
    [
      "Vouch agent passport registration",
      "agentId: 42",
      "wallet: 0xabc0000000000000000000000000000000000001",
      "name: Acme Agent",
      "This signature only proves control of the wallet above.",
    ].join("\n"),
  );
  // Exactly 5 lines — the structural invariant the anti-injection rule protects.
  assert.equal(msg.split("\n").length, 5);
});

test("agentPassportMessage refuses a name that would forge extra lines", () => {
  assert.throws(() => agentPassportMessage(1n, "0x0000000000000000000000000000000000000001", "Acme\nwallet: 0xEVIL"));
  assert.throws(() => agentPassportMessage(1n, "0x0000000000000000000000000000000000000001", "Acme\tCorp"));
  assert.throws(() => agentPassportMessage(1n, "0x0000000000000000000000000000000000000001", " untrimmed"));
  assert.throws(() => agentPassportMessage(1n, "0x0000000000000000000000000000000000000001", ""));
});

test("a signature over the canonical message verifies against the signing wallet", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const agentId = 777n;
  const name = "北条エージェント";
  const message = agentPassportMessage(agentId, account.address, name);

  const signature = await account.signMessage({ message });
  const ok = await verifyMessage({ address: account.address, message, signature });
  assert.equal(ok, true);
});

test("tampering with the name (or agentId) breaks verification", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const signedMessage = agentPassportMessage(5n, account.address, "Real Name");
  const signature = await account.signMessage({ message: signedMessage });

  // A verifier reconstructs the message from the CLAIMED (tampered) fields;
  // the signature no longer matches, so control is not proven.
  const tamperedName = agentPassportMessage(5n, account.address, "Spoofed Name");
  assert.equal(await verifyMessage({ address: account.address, message: tamperedName, signature }), false);

  const tamperedId = agentPassportMessage(6n, account.address, "Real Name");
  assert.equal(await verifyMessage({ address: account.address, message: tamperedId, signature }), false);
});

test("a signature from a different wallet does not verify (impersonation guard)", async () => {
  const realOwner = privateKeyToAccount(generatePrivateKey());
  const attacker = privateKeyToAccount(generatePrivateKey());
  // The message names the real owner's wallet, but the attacker signs it.
  const message = agentPassportMessage(9n, realOwner.address, "Victim Agent");
  const attackerSig = await attacker.signMessage({ message });
  assert.equal(await verifyMessage({ address: realOwner.address, message, signature: attackerSig }), false);
});
