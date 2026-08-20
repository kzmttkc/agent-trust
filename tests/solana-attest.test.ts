// ============================================================
// Solana Memo 刻印 v0（#3）。固定する性質:
//  - 既定OFF: フラグ無しでは disabled・DBにもtxにも触らない
//  - レコードは決定的（同入力→同hash）・memoに hash と証拠URIが入る
//  - tx は自払い（feePayer=我々）・自署名済み・Memoプログラム1命令
//  - 冪等: 同hashの二度目は duplicate・送信ゼロ
// ============================================================
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { __setDbForTests } from "@/lib/db/client";
import {
  buildSolanaAttestRecord,
  buildAttestTransaction,
  publishSolanaAttestation,
} from "@/lib/chain/solana-attest";

const KEYPAIR = Keypair.fromSeed(new Uint8Array(32).fill(3));
const BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";
const RECORD_INPUT = {
  endpointId: "5f0c9c5e-2c3a-4b1e-9a4d-8f6b2e1c7d0a",
  payTo: "GqSs5L9aPWGJwyRQe35YKQaWMDPh3R1dMqfSEPhSgkM",
  level: "l1" as const,
  verdict: "pass" as const,
  evidenceUri: "https://vet402.com/observatory/e/5f0c9c5e-2c3a-4b1e-9a4d-8f6b2e1c7d0a",
};

afterEach(() => {
  __setDbForTests(null);
  delete process.env.SOLANA_ATTEST_ENABLED;
});

test("既定OFF → disabled・送信ゼロ", async () => {
  let sends = 0;
  const out = await publishSolanaAttestation({
    record: buildSolanaAttestRecord(RECORD_INPUT),
    payer: KEYPAIR,
    recentBlockhash: BLOCKHASH,
    sendTransaction: async () => {
      sends++;
      return "sig";
    },
  });
  assert.deepEqual(out, { status: "disabled" });
  assert.equal(sends, 0);
});

test("レコードは決定的・memoにhashと証拠URI", () => {
  const a = buildSolanaAttestRecord(RECORD_INPUT);
  const b = buildSolanaAttestRecord(RECORD_INPUT);
  assert.equal(a.requestHash, b.requestHash);
  assert.ok(a.memoText.includes(a.requestHash));
  assert.ok(a.memoText.includes(RECORD_INPUT.evidenceUri));
});

test("txは自払い・自署名・Memo1命令で、memo原文が入る", () => {
  const record = buildSolanaAttestRecord(RECORD_INPUT);
  const { transactionB64 } = buildAttestTransaction({ record, payer: KEYPAIR, recentBlockhash: BLOCKHASH });
  const tx = VersionedTransaction.deserialize(Buffer.from(transactionB64, "base64"));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  assert.equal(keys[0], KEYPAIR.publicKey.toBase58(), "self-paid");
  assert.ok(tx.signatures[0].some((b) => b !== 0), "self-signed");
  assert.equal(tx.message.compiledInstructions.length, 1);
  const ix = tx.message.compiledInstructions[0];
  assert.equal(keys[ix.programIdIndex], "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  assert.equal(Buffer.from(ix.data).toString("utf8"), record.memoText);
});

test("冪等: 同hash二度目は duplicate・送信ゼロ", async () => {
  process.env.SOLANA_ATTEST_ENABLED = "true";
  let call = 0;
  __setDbForTests({
    async execute() {
      call++;
      return { rows: call === 1 ? [{ id: "row1" }] : [] };
    },
    update() {
      return { set: () => ({ where: async () => undefined }) };
    },
  } as never);
  let sends = 0;
  const args = {
    record: buildSolanaAttestRecord(RECORD_INPUT),
    payer: KEYPAIR,
    recentBlockhash: BLOCKHASH,
    sendTransaction: async () => {
      sends++;
      return "5SigBase58";
    },
  };
  const first = await publishSolanaAttestation(args);
  const second = await publishSolanaAttestation(args);
  assert.equal(first.status, "submitted");
  assert.deepEqual(second, { status: "duplicate" });
  assert.equal(sends, 1);
});
