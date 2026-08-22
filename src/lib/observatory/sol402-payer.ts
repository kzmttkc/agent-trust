// ============================================================
// SOL-402 payer（Phase 1.2）——Solana mainnet 上の x402 `exact` scheme。
//
// 正本仕様: coinbase/x402 specs/schemes/exact/scheme_exact_svm.md（2026-08-20
// 取得）。クライアントは部分署名した versioned tx を base64 で X-PAYMENT系
// ヘッダに載せる。命令列は SetComputeUnitLimit(2) → SetComputeUnitPrice(3,
// ≤5/CU) → SPL TransferChecked → Memo（extra.memo があればその値・無ければ
// ランダム nonce ≥16 bytes）。feePayer は challenge の extra.feePayer
// （ファシリテータ）で、どの命令の accounts にも現れてはならない。
//
// v0 の運用前提: 我々のウォレットは USDC(SPL) だけ持ち、SOL を持たない。
// だから extra.feePayer の無い challenge は「支払えない」ではなく
// no_fee_payer として静かに skip する（fail-closed・資金は動かない）。
//
// EVM 側（x402-payer.ts）と同じく、ここは純関数の層。ネットワーク I/O
// （blockhash 取得・送信）は呼び手が担い、テストは生成物を逆デシリアライズ
// して spec の MUST を機械検証する。
// ============================================================
import { randomBytes } from "node:crypto";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MAX_PER_PURCHASE_UNITS, type ChallengeAccept } from "./x402-payer";

export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/** Canonical USDC mint on Solana mainnet (decimals 6 — same base units as Base USDC). */
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function isSolanaL1Enabled(): boolean {
  return process.env.OBSERVATORY_SOLANA_L1_ENABLED === "true";
}

export type SolanaAcceptSelection =
  | { accept: ChallengeAccept; reason: null }
  | {
      accept: null;
      reason:
        | "no_eligible_accept"
        | "price_mismatch"
        | "payto_mismatch"
        | "over_cap"
        | "no_fee_payer";
    };

function feePayerOf(accept: ChallengeAccept): string | null {
  const fp = accept.extra?.feePayer;
  return typeof fp === "string" && fp.length > 0 ? fp : null;
}

/**
 * EVM 側 selectAccept と同じ拒否語彙 + Solana 固有の no_fee_payer。
 * payTo の catalog 照合は case-insensitive: 2026-08-20 以前の取込が base58 を
 * 小文字化して保存していたため（修復スクリプトで直すが、照合を大文字小文字に
 * 依存させない）。tx の宛先には常に「壁が言った」正しい大文字小文字を使う。
 */
export function selectSolanaAccept(
  accepts: readonly unknown[],
  options: { declaredAmount: string | null; declaredPayTo: string | null },
): SolanaAcceptSelection {
  const protocolEligible = (accepts as ChallengeAccept[])
    .filter((a) => a && typeof a === "object")
    .filter((a) => a.scheme === "exact")
    .filter((a) => a.network === SOLANA_MAINNET_CAIP2)
    .filter((a) => a.asset === SOLANA_USDC_MINT);

  if (protocolEligible.length === 0) return { accept: null, reason: "no_eligible_accept" };

  // 2026-08-22: 受取先の食い違いは「機械的に支払えない壁」ではなく**売り手に
  // ついての所見**なので、no_eligible_accept に潰さず payto_mismatch として
  // 報告する（EVM 側 selectAccept と同じ語彙・同じ順序）。
  const declaredPayTo =
    options.declaredPayTo === null ? null : options.declaredPayTo.toLowerCase();
  const eligible =
    declaredPayTo === null
      ? protocolEligible
      : protocolEligible.filter((a) => a.payTo.toLowerCase() === declaredPayTo);
  if (eligible.length === 0) return { accept: null, reason: "payto_mismatch" };

  const sponsored = eligible.filter((a) => feePayerOf(a) !== null);
  if (sponsored.length === 0) return { accept: null, reason: "no_fee_payer" };

  for (const accept of sponsored) {
    let amount: bigint;
    try {
      amount = BigInt(accept.amount);
    } catch {
      continue;
    }
    if (amount <= 0n) continue;
    if (options.declaredAmount !== null && accept.amount !== options.declaredAmount) continue;
    if (amount > MAX_PER_PURCHASE_UNITS) continue;
    return { accept, reason: null };
  }

  const allOverCap = sponsored.every((a) => {
    try {
      return BigInt(a.amount) > MAX_PER_PURCHASE_UNITS;
    } catch {
      return true;
    }
  });
  if (allOverCap) return { accept: null, reason: "over_cap" };
  if (
    options.declaredAmount !== null &&
    sponsored.some((a) => a.amount !== options.declaredAmount)
  ) {
    return { accept: null, reason: "price_mismatch" };
  }
  return { accept: null, reason: "no_eligible_accept" };
}

/**
 * 部分署名 versioned tx を組む（純関数——blockhash は呼び手が渡す）。
 * spec の MUST: feePayer が命令 accounts に現れないこと・宛先が
 * ATA(payTo, mint) であることは、この構成では構造的に満たされる
 * （テストが逆デシリアライズで検証している）。
 */
export async function buildSolanaPaymentTransaction(input: {
  accept: ChallengeAccept;
  payer: Keypair;
  recentBlockhash: string;
}): Promise<{ transactionB64: string; payerAddress: string }> {
  const { accept, payer, recentBlockhash } = input;
  const feePayer = feePayerOf(accept);
  if (!feePayer) throw new Error("sol402: accept has no extra.feePayer");
  const mint = new PublicKey(accept.asset);
  const payTo = new PublicKey(accept.payTo);
  const amount = BigInt(accept.amount);

  const sourceAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const destAta = getAssociatedTokenAddressSync(mint, payTo);

  const memoValue =
    typeof accept.extra?.memo === "string" && accept.extra.memo !== ""
      ? accept.extra.memo
      : randomBytes(16).toString("hex");

  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    // microLamports 単位。spec の上限（≤5/CU）のさらに内側の 1 に固定。
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createTransferCheckedInstruction(sourceAta, mint, destAta, payer.publicKey, amount, USDC_DECIMALS),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoValue, "utf8"),
    }),
  ];

  const message = new TransactionMessage({
    payerKey: new PublicKey(feePayer),
    recentBlockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  return {
    transactionB64: Buffer.from(tx.serialize()).toString("base64"),
    payerAddress: payer.publicKey.toBase58(),
  };
}

/** v2 envelope（EVM 側 encodePaymentHeader と同形・payload だけ transaction）。 */
export function encodeSolanaPaymentHeader(input: {
  accept: ChallengeAccept;
  transactionB64: string;
  resourceUrl: string;
}): { headerName: string; headerValue: string } {
  const { accept, transactionB64, resourceUrl } = input;
  const body = {
    x402Version: 2,
    resource: { url: resourceUrl },
    accepted: {
      scheme: accept.scheme,
      network: accept.network,
      amount: accept.amount,
      asset: accept.asset,
      payTo: accept.payTo,
      ...(accept.maxTimeoutSeconds !== undefined
        ? { maxTimeoutSeconds: accept.maxTimeoutSeconds }
        : {}),
      ...(accept.extra !== undefined ? { extra: accept.extra } : {}),
    },
    payload: { transaction: transactionB64 },
  };
  return {
    headerName: "PAYMENT-SIGNATURE",
    headerValue: Buffer.from(JSON.stringify(body)).toString("base64"),
  };
}
