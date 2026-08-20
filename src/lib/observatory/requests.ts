// ============================================================
// 公開検証リクエストキュー v0（C9・無償枠）。
//
// 誰でも「このエンドポイントを測って」を積める。実測定は日次 L0 cron が
// キューを先に消化する形で行い、行は通常のプローブとして記帳される
// （trigger: "request"）。リクエストが多いことは測定を歪めない——
// 順番が前後するだけで、判定のゲートは常に同一。
//
// 有償優先枠（x402課金＝自社ドッグフード）は self-listing 計画と統合して
// 後日。テーブルは tier/payment_ref を既に持つが、v0 は常に free。
// ============================================================
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { verificationRequests, x402Endpoints, x402L0Probes } from "@/lib/db/schema";
import { probeEndpoint, type ProbeOptions } from "./l0-probe";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EnqueueResult =
  | { ok: true; id: string; deduped: boolean }
  | { ok: false; reason: "invalid_input" | "endpoint_not_found" | "db_unavailable" };

export async function enqueueVerificationRequest(input: {
  endpointId: string;
  requesterIp: string | null;
}): Promise<EnqueueResult> {
  if (!UUID_RE.test(input.endpointId)) return { ok: false, reason: "invalid_input" };
  const db = getDb();
  if (!db) return { ok: false, reason: "db_unavailable" };

  const [ep] = await db
    .select({ id: x402Endpoints.id })
    .from(x402Endpoints)
    .where(eq(x402Endpoints.id, input.endpointId))
    .limit(1);
  if (!ep) return { ok: false, reason: "endpoint_not_found" };

  // 同一エンドポイントの pending は1件に畳む（キューの水増しをさせない）。
  const [pending] = await db
    .select({ id: verificationRequests.id })
    .from(verificationRequests)
    .where(
      and(
        eq(verificationRequests.endpointId, input.endpointId),
        eq(verificationRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (pending) return { ok: true, id: pending.id, deduped: true };

  const [row] = await db
    .insert(verificationRequests)
    .values({ endpointId: input.endpointId, requesterIp: input.requesterIp })
    .returning();
  return { ok: true, id: row.id, deduped: false };
}

export type DrainSummary = { drained: number; probed: number; invalid: number };

/**
 * 日次 L0 cron の冒頭で呼ぶ。pending を古い順に limit 件、実プローブして
 * 記帳し、probed へ落とす。エンドポイントが消えていた行は invalid。
 */
export async function drainVerificationRequests(
  limit: number,
  options: ProbeOptions = {},
): Promise<DrainSummary> {
  const db = getDb();
  if (!db) return { drained: 0, probed: 0, invalid: 0 };
  const raw = await db.execute(sql`
    SELECT vr.id, vr.endpoint_id, e.resource_url, e.method, e.pay_to, e.network,
           e.price_amount, e.price_asset, (e.id IS NULL) AS missing
    FROM verification_requests vr
    LEFT JOIN x402_endpoints e ON e.id = vr.endpoint_id
    WHERE vr.status = 'pending'
    ORDER BY vr.created_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
    string,
    unknown
  >[];
  const summary: DrainSummary = { drained: rows.length, probed: 0, invalid: 0 };
  for (const r of rows) {
    const id = String(r.id);
    if (r.missing === true || !r.resource_url) {
      await db
        .update(verificationRequests)
        .set({ status: "invalid" })
        .where(eq(verificationRequests.id, id));
      summary.invalid++;
      continue;
    }
    try {
      const probe = await probeEndpoint(
        {
          resourceUrl: String(r.resource_url),
          method: (r.method as string | null) ?? null,
          payTo: (r.pay_to as string | null) ?? null,
          network: (r.network as string | null) ?? null,
          priceAmount: (r.price_amount as string | null) ?? null,
          priceAsset: (r.price_asset as string | null) ?? null,
        },
        options,
      );
      await db.insert(x402L0Probes).values({
        endpointId: String(r.endpoint_id),
        method: probe.method,
        verdict: probe.verdict,
        httpStatus: probe.httpStatus,
        acceptsValid: probe.acceptsValid,
        priceConsistent: probe.priceConsistent,
        metadataConsistent: probe.metadataConsistent,
        latencyMs: probe.latencyMs,
        failReason: probe.failReason,
        rawResponseMeta: { ...probe.rawResponseMeta, trigger: "request", requestId: id },
      });
      await db
        .update(verificationRequests)
        .set({ status: "probed", probedAt: new Date() })
        .where(eq(verificationRequests.id, id));
      summary.probed++;
    } catch {
      // 次回の drain で再試行される（pending のまま）。
    }
  }
  return summary;
}
