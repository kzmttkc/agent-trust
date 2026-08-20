// ============================================================
// 売り手の署名付き異議（C8）——中立性の制度化。
//
// 申し立てられるのは endpoint の payTo を実際に握る者だけ（EIP-191。
// Solana payTo の Ed25519 は後続——v0 は 0x のみ）。受理と同時に本物の
// L0 を1回再測定し、**通常のプローブ行として**台帳へ書く——demo と違い
// これは正規の測定（売り手起点というだけ）で、公開判定の2連続fail
// ゲートも普段どおり適用される。申し立てで記録が消えることはない。
//
// メッセージ正規形（署名対象）:
//   vet402:dispute:v0:{endpointId}:{subject}:{sha256(reason)}
// reason 本文は台帳に原文保存（監査可能性）。
// ============================================================
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { verifyMessage } from "viem";
import { getDb } from "@/lib/db/client";
import { disputes, x402Endpoints, x402L0Probes } from "@/lib/db/schema";
import { probeEndpoint, type ProbeOptions } from "./l0-probe";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBJECTS = new Set(["l0", "l1", "listing"]);

export function disputeMessage(input: { endpointId: string; subject: string; reason: string }): string {
  const reasonHash = createHash("sha256").update(input.reason, "utf8").digest("hex");
  return `vet402:dispute:v0:${input.endpointId}:${input.subject}:${reasonHash}`;
}

export type DisputeResult =
  | { ok: true; id: string; remeasureVerdict: string | null }
  | {
      ok: false;
      reason:
        | "invalid_input"
        | "endpoint_not_found"
        | "not_payto_signer"
        | "invalid_signature"
        | "unsupported_payto"
        | "db_unavailable";
    };

export async function submitDispute(
  input: {
    endpointId: string;
    subject: string;
    reason: string;
    address: string;
    signature: string;
  },
  probeOptions: ProbeOptions = {},
): Promise<DisputeResult> {
  if (!UUID_RE.test(input.endpointId)) return { ok: false, reason: "invalid_input" };
  if (!SUBJECTS.has(input.subject)) return { ok: false, reason: "invalid_input" };
  if (input.reason.trim().length === 0 || input.reason.length > 4000) {
    return { ok: false, reason: "invalid_input" };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.address)) return { ok: false, reason: "invalid_input" };

  const db = getDb();
  if (!db) return { ok: false, reason: "db_unavailable" };

  const [ep] = await db
    .select()
    .from(x402Endpoints)
    .where(eq(x402Endpoints.id, input.endpointId))
    .limit(1);
  if (!ep) return { ok: false, reason: "endpoint_not_found" };
  if (!ep.payTo) return { ok: false, reason: "unsupported_payto" };
  if (!ep.payTo.startsWith("0x")) return { ok: false, reason: "unsupported_payto" };
  if (ep.payTo.toLowerCase() !== input.address.toLowerCase()) {
    return { ok: false, reason: "not_payto_signer" };
  }

  const message = disputeMessage(input);
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

  const [row] = await db
    .insert(disputes)
    .values({
      endpointId: input.endpointId,
      subject: input.subject,
      reason: input.reason,
      signer: input.address.toLowerCase(),
      message,
      signature: input.signature,
    })
    .returning();

  // 再測定——正規のプローブ行として記帳（公開ゲートは普段どおり）。
  // 失敗しても dispute の受理は既に立っている（graceful）。
  let remeasureVerdict: string | null = null;
  try {
    const probe = await probeEndpoint(
      {
        resourceUrl: ep.resourceUrl,
        method: ep.method,
        payTo: ep.payTo,
        network: ep.network,
        priceAmount: ep.priceAmount,
        priceAsset: ep.priceAsset,
      },
      probeOptions,
    );
    await db.insert(x402L0Probes).values({
      endpointId: ep.id,
      method: probe.method,
      verdict: probe.verdict,
      httpStatus: probe.httpStatus,
      acceptsValid: probe.acceptsValid,
      priceConsistent: probe.priceConsistent,
      metadataConsistent: probe.metadataConsistent,
      latencyMs: probe.latencyMs,
      failReason: probe.failReason,
      rawResponseMeta: { ...probe.rawResponseMeta, trigger: "dispute", disputeId: row.id },
    });
    remeasureVerdict = probe.verdict;
    await db
      .update(disputes)
      .set({ status: "remeasured", remeasureVerdict })
      .where(eq(disputes.id, row.id));
  } catch {
    /* dispute stands; remeasure can be retried by ops */
  }

  return { ok: true, id: row.id, remeasureVerdict };
}
