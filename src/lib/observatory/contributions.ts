// ============================================================
// 許可不要 L0 コントリビューション v0（Phase 3.3・既定OFF）。
//
// v0 の約束は1つだけ:「署名付きの外部観測を、公開判定に混ぜずに保存する」。
// 公開 verdict の正典は自前プローブ（publishedVerdict）のまま動かさない。
// 外部観測が判定に効くのは、重み付け・sybil耐性・監査を設計した v1 から。
//
// 署名は EIP-191 personal_sign。メッセージは決定的な正規形（下記 v0 形式）
// で、保存時に原文ごと台帳へ残す——後から「何に署名したか」を検証できる。
// ============================================================
import { verifyMessage } from "viem";
import { getDb } from "@/lib/db/client";
import { probeContributions } from "@/lib/db/schema";

export function isContributionsEnabled(): boolean {
  return process.env.CONTRIBUTIONS_ENABLED === "true";
}

const VERDICTS = new Set(["pass", "fail", "unverified"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function contributionMessage(input: {
  endpointId: string;
  verdict: string;
  httpStatus: number | null;
  latencyMs: number | null;
}): string {
  return `vet402:contribution:v0:${input.endpointId}:${input.verdict}:${input.httpStatus ?? ""}:${input.latencyMs ?? ""}`;
}

export type ContributionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        | "contributions_disabled"
        | "invalid_input"
        | "invalid_signature"
        | "db_unavailable";
    };

export async function submitContribution(input: {
  endpointId: string;
  verdict: string;
  httpStatus: number | null;
  latencyMs: number | null;
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
