import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getEndpointPurchases } from "@/lib/observatory/reader";

/**
 * Farcaster Frame 用の 1200×630 PNG（Phase 2.4）。エンドポイントの
 * レシート実績（試行/決済・settle率）を紙面様式のトーンで描く。
 * 語彙は他の公開面と同じ: 数と分母のみ・評価語なし。
 * SVGバッジでなくPNGなのは、Farcasterクライアントのimage要件のため。
 */
// Node runtime のまま: getEndpointPurchases は self-host では TCP の
// postgres ドライバを使うため edge では動かない（ローカル実測 500）。
// ImageResponse は Node runtime でも動作する。
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const data = await getEndpointPurchases(id);

  const title = data ? data.resourceKey : "unknown endpoint";
  const attempts = data?.attemptCount ?? 0;
  const settled = data?.settledCount ?? 0;
  const rate = data?.settleRatePct;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#f4f2ec",
          color: "#1e2a3a",
          padding: 64,
          fontSize: 32,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28 }}>
          <span>Independent Measurement</span>
          <span style={{ fontWeight: 700 }}>vet402</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{title}</div>
          <div style={{ display: "flex", gap: 48, fontSize: 36 }}>
            <span>{`real purchases: ${attempts}`}</span>
            <span>{`settled: ${settled}`}</span>
            <span>{rate === null || rate === undefined ? "settle rate: —" : `settle rate: ${rate}%`}</span>
          </div>
          <div style={{ fontSize: 26, color: "#4a5568" }}>
            Every receipt public, transaction hash included. Failures published with the same
            weight.
          </div>
        </div>
        <div style={{ fontSize: 24, color: "#4a5568" }}>vet402.com/observatory — facts with denominators, not opinions</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
