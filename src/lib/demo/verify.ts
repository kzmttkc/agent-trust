// ============================================================
// /playground のデモ検証コア（Phase 0.1・仕様書§4）。
//
// 観測所の L0 プローブ（probeEndpoint・SSRFガード内蔵）をカタログの
// 1 エンドポイントに対してライブ実行して返すだけの薄い呼び口。
//
// ここは「見せるための呼び口」であって測定系ではない:
//   - 結果を x402_l0_probes へ書かない。デモ起因の測定が公開台帳の
//     ケイデンス（日次プローブ・連続fail判定）を汚さないため、この
//     モジュールは writer を一切 import しない。
//   - 資金は動かない（L0 は 402 チャレンジの観測のみ）。
//   - fail-closed: DB が無い・行が無い・廃止済みなら リクエストを送らず 拒否。
// ============================================================
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { x402Endpoints } from "@/lib/db/schema";
import { probeEndpoint, type ProbeOptions, type ProbeResult } from "@/lib/observatory/l0-probe";

export type DemoVerifyResult =
  | {
      ok: true;
      endpoint: { id: string; resourceKey: string; payTo: string | null; network: string | null };
      probe: ProbeResult;
    }
  | { ok: false; reason: "endpoint_not_found" | "endpoint_inactive" | "db_unavailable" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runDemoL0(
  endpointId: string,
  options: ProbeOptions = {},
): Promise<DemoVerifyResult> {
  // UUID 検査を DB より先に。形の不正はカタログ照会にすら値しない
  // （不正入力で pg のキャスト例外を踏ませない）。
  if (!UUID_RE.test(endpointId)) return { ok: false, reason: "endpoint_not_found" };

  const db = getDb();
  if (!db) return { ok: false, reason: "db_unavailable" };

  const [row] = await db
    .select()
    .from(x402Endpoints)
    .where(eq(x402Endpoints.id, endpointId))
    .limit(1);
  if (!row) return { ok: false, reason: "endpoint_not_found" };
  if (row.status !== "active") return { ok: false, reason: "endpoint_inactive" };

  const probe = await probeEndpoint(
    {
      resourceUrl: row.resourceUrl,
      method: row.method,
      payTo: row.payTo,
      network: row.network,
      priceAmount: row.priceAmount,
      priceAsset: row.priceAsset,
    },
    options,
  );

  return {
    ok: true,
    endpoint: { id: row.id, resourceKey: row.resourceKey, payTo: row.payTo, network: row.network },
    probe,
  };
}
