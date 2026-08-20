// ============================================================
// Solana 側の検証記録刻印 v0（#3・既定OFF）。
//
// ERC-8004 Validation Registry の Solana 等価物への足がかり。v0 は
// Memo プログラムに決定的な検証レコード（registry.ts と同じ canonical
// JSON の keccak256）を刻む——専用プログラム（Anchor）は資金・監査を
// 経た後続で、メモ刻印はその間も「チェーン上に検証結果が実在する」を
// 成立させる最小形。
//
// 手数料は自払い（feePayer = 我々の鍵）なので SOL 残高が要る＝
// SOLANA_ATTEST_ENABLED は既定OFF（入金は承認事項）。冪等性は
// registry_writes 台帳（request_hash 一意）を ERC-8004 側と共用する。
// agent_id 列には `sol:{payTo}` を入れる——このテーブルの主語は
// 「レジストリが誰の何を指すか」で、Solana に agentId は無いため。
// ============================================================
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { keccak256, toBytes } from "viem";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { registryWrites } from "@/lib/db/schema";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function isSolanaAttestEnabled(): boolean {
  return process.env.SOLANA_ATTEST_ENABLED === "true";
}

export type SolanaAttestRecord = {
  endpointId: string;
  payTo: string;
  level: "l0" | "l1" | "l2";
  verdict: "pass" | "fail";
  evidenceUri: string;
  requestHash: `0x${string}`;
  memoText: string;
};

/** registry.ts と同系の決定的レコード。memo は hash + 証拠URIの最小形。 */
export function buildSolanaAttestRecord(input: {
  endpointId: string;
  payTo: string;
  level: "l0" | "l1" | "l2";
  verdict: "pass" | "fail";
  evidenceUri: string;
}): SolanaAttestRecord {
  const canonical = JSON.stringify({
    v: 1,
    chain: "solana",
    endpointId: input.endpointId,
    payTo: input.payTo,
    level: input.level,
    verdict: input.verdict,
    evidenceUri: input.evidenceUri,
  });
  const requestHash = keccak256(toBytes(canonical));
  return {
    ...input,
    requestHash,
    memoText: `vet402:attest:v1:${input.level}:${input.verdict}:${requestHash}:${input.evidenceUri}`,
  };
}

/** 自払い・自署名の Memo tx（純関数——blockhash と送信は呼び手）。 */
export function buildAttestTransaction(input: {
  record: SolanaAttestRecord;
  payer: Keypair;
  recentBlockhash: string;
}): { transactionB64: string } {
  const instructions = [
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(input.record.memoText, "utf8"),
    }),
  ];
  const message = new TransactionMessage({
    payerKey: input.payer.publicKey,
    recentBlockhash: input.recentBlockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([input.payer]);
  return { transactionB64: Buffer.from(tx.serialize()).toString("base64") };
}

export type AttestOutcome =
  | { status: "disabled" }
  | { status: "duplicate" }
  | { status: "submitted"; signature: string }
  | { status: "failed"; error: string };

/**
 * 冪等台帳（registry_writes 共用）→送信。sendTransaction は注入
 * （テストはキャプチャ・本番は web3.js Connection）。
 */
export async function publishSolanaAttestation(input: {
  record: SolanaAttestRecord;
  payer: Keypair;
  recentBlockhash: string;
  sendTransaction: (transactionB64: string) => Promise<string>;
}): Promise<AttestOutcome> {
  if (!isSolanaAttestEnabled()) return { status: "disabled" };
  const db = getDb();
  if (!db) return { status: "failed", error: "db_unavailable" };

  const { record } = input;
  const inserted = await db.execute(sql`
    INSERT INTO registry_writes (request_hash, endpoint_id, agent_id, level, response, evidence_uri, status)
    VALUES (${record.requestHash}, ${record.endpointId}::uuid, ${"sol:" + record.payTo},
            ${record.level}, ${record.verdict === "pass" ? 100 : 0}, ${record.evidenceUri}, 'pending')
    ON CONFLICT (request_hash) DO NOTHING
    RETURNING id
  `);
  const rows = (Array.isArray(inserted) ? inserted : (inserted as { rows?: unknown[] }).rows ?? []) as {
    id: string;
  }[];
  if (rows.length === 0) return { status: "duplicate" };
  const ledgerId = rows[0].id;

  try {
    const { transactionB64 } = buildAttestTransaction(input);
    const signature = await input.sendTransaction(transactionB64);
    await db
      .update(registryWrites)
      .set({ status: "submitted", txHash: signature })
      .where(eq(registryWrites.id, ledgerId));
    return { status: "submitted", signature };
  } catch (error) {
    await db.update(registryWrites).set({ status: "failed" }).where(eq(registryWrites.id, ledgerId));
    return { status: "failed", error: String(error).slice(0, 300) };
  }
}
