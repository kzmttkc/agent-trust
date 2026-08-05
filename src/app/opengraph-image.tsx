import { ImageResponse } from "next/og";

// ============================================================
// OG card (2026-08-05 R&D, WORK_ORDERS #-10).
//
// Measured before this: og:title/twitter:card were set but og:image was not,
// so every share of the site rendered as a bare text stub. The card is
// rendered in code from the same sample-response layout the homepage shows —
// product UI, not generated artwork — so it stays consistent with the page a
// clicker lands on and needs no binary asset checked into the repo.
// ============================================================

export const runtime = "edge";
export const alt = "Vouch — trust scores for AI agents and x402 payees on Base";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SCORE = 78;
const RADIUS = 84;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function OgImage() {
  const offset = CIRCUMFERENCE * (1 - SCORE / 100);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: 64,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#18181b" }}>Vouch</div>
            <div style={{ fontSize: 20, color: "#71717a", marginTop: 6 }}>
              Trust layer for agent commerce
            </div>
          </div>
          <div
            style={{
              display: "flex",
              background: "#d1fae5",
              color: "#065f46",
              borderRadius: 9999,
              padding: "12px 28px",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            ALLOW
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 56 }}>
          <svg width={220} height={220} viewBox="0 0 220 220">
            <circle cx="110" cy="110" r={RADIUS} fill="none" stroke="#e4e4e7" strokeWidth="18" />
            <circle
              cx="110"
              cy="110"
              r={RADIUS}
              fill="none"
              stroke="#18181b"
              strokeWidth="18"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              transform="rotate(-90 110 110)"
            />
            <text
              x="110"
              y="126"
              textAnchor="middle"
              fontSize="52"
              fontWeight="700"
              fill="#18181b"
            >
              {SCORE}
            </text>
          </svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#18181b", lineHeight: 1.15 }}>
              Should your agent accept this payment?
            </div>
            <div style={{ fontSize: 24, color: "#52525b", lineHeight: 1.45 }}>
              ERC-8004 trust scores on Base — one API call before an x402 payment settles.
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 20,
            color: "#71717a",
            fontFamily: "monospace",
          }}
        >
          <div>GET /api/v1/agents/:id/score</div>
          <div>REST · MCP · SDK · x402 middleware</div>
        </div>
      </div>
    ),
    size,
  );
}
