// ============================================================
// 許可不要 L0 コントリビューション v0（Phase 3.3・既定OFF）。
//
// v0 の約束は1つだけ:「署名付きの外部観測を、公開判定に混ぜずに保存する」。
// 公開 verdict の正典は自前プローブ（publishedVerdict）のまま動かさない。
// 外部観測が判定に効くのは、重み付け・sybil耐性・監査を設計した v1 から。
//
// 署名は EIP-191 personal_sign。メッセージは決定的な正規形（下記のメッセージ v1 形式）
// で、保存時に原文ごと台帳へ残す——後から「何に署名したか」を検証できる。
//
// 2026-08-22（監査残件）: v0 のメッセージには nonce も timestamp も無く、
// 一度公開された署名は永久に再送可能な書き込み資格だった。既定OFFで公開
// verdict にも混ざらないとはいえ、欠陥の形は payees/verify・agents/verify
// で 2026-08-18 に塞いだものと同一なので、同じ方式で塞ぐ——署名対象に
// `issued` を畳み込み、鮮度窓（10分・両方向）を検証し、同一メッセージの
// 二重受理を拒否する。接頭辞は v1 へ（台帳の過去 v0 原文と混ぜない）。
// ——この v1 は「メッセージ形式のバージョン」であって、上段の
// 「外部観測が判定に効く v1」という機能フェーズとは別物。
// ============================================================
import { eq } from "drizzle-orm";
import { verifyMessage } from "viem";
import { getDb } from "@/lib/db/client";
import { probeContributions } from "@/lib/db/schema";
import { isValidIssuedAt } from "@/lib/verify-message";
import { UUID_RE } from "@/lib/validation/uuid";

/** payees/verify の ISSUED_WINDOW_MS と同じ 10 分。 */
const ISSUED_WINDOW_MS = 10 * 60_000;

export function isContributionsEnabled(): boolean {
  return process.env.CONTRIBUTIONS_ENABLED === "true";
}

const VERDICTS = new Set(["pass", "fail", "unverified"]);
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function contributionMessage(input: {
  endpointId: string;
  verdict: string;
  httpStatus: number | null;
  latencyMs: number | null;
  issued: string;
}): string {
  return `vet402:contribution:v1:${input.endpointId}:${input.verdict}:${input.httpStatus ?? ""}:${input.latencyMs ?? ""}:${input.issued}`;
}

export type ContributionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "contributions_disabled"
        | "invalid_input"
        | "invalid_signature"
        | "signature_expired"
        | "replayed"
        | "db_unavailable";
    };

export async function submitContribution(input: {
  endpointId: string;
  verdict: string;
  httpStatus: number | null;
  latencyMs: number | null;
  /** 署名者が畳み込んだ発行時刻（Date#toISOString() の厳密な形）。 */
  issued: string;
  address: string;
  signature: string;
}): Promise<ContributionResult> {
  if (!isContributionsEnabled()) return { ok: false, reason: "contributions_disabled" };
  if (!UUID_RE.test(input.endpointId)) return { ok: false, reason: "invalid_input" };
  if (!VERDICTS.has(input.verdict)) return { ok: false, reason: "invalid_input" };
  if (!ADDR_RE.test(input.address)) return { ok: false, reason: "invalid_input" };
  if (input.httpStatus !== null && !Number.isInteger(input.httpStatus)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (input.latencyMs !== null && !Number.isInteger(input.latencyMs)) {
    return { ok: false, reason: "invalid_input" };
  }
  if (!isValidIssuedAt(input.issued)) return { ok: false, reason: "invalid_input" };
  if (Math.abs(Date.now() - Date.parse(input.issued)) > ISSUED_WINDOW_MS) {
    return { ok: false, reason: "signature_expired" };
  }

  const message = contributionMessage(input);
  let valid = false;
  try {
    valid = await verifyMessage({
      address: input.address as `0x${string}`,
      message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "invalid_signature" };

  const db = getDb();
  if (!db) return { ok: false, reason: "db_unavailable" };

  // 鮮度窓の内側の再送も1回きり。message は issued を含むので、観測内容か
  // 時刻が違えば別メッセージになり、正当な連投は妨げない。
  const [replayed] = await db
    .select({ id: probeContributions.id })
    .from(probeContributions)
    .where(eq(probeContributions.message, message))
    .limit(1);
  if (replayed) return { ok: false, reason: "replayed" };

  const [row] = await db
    .insert(probeContributions)
    .values({
      endpointId: input.endpointId,
      submitter: input.address.toLowerCase(),
      verdict: input.verdict,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
      message,
      signature: input.signature,
    })
    .returning();
  return { ok: true, id: row.id };
}
