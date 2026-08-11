"use client";

/**
 * ScorePreviewCard — the homepage score card.
 *
 * 2026-08-05 R&D: this used to be a hard-coded "sample response". For a
 * product whose pitch is "the score is computed from real chain data", a
 * fabricated 78 was the weakest possible first impression. The card now
 * renders the static sample instantly (no layout shift, no spinner) and then
 * swaps in a LIVE score from /api/demo/score — a real ERC-8004 agent scored
 * by the real engine, timestamped. If the live call fails, the static sample
 * stays and keeps saying "sample": the card must never look more real than
 * it is in either direction.
 */

import { useEffect, useState } from "react";

import { VerdictBadge } from "./VerdictBadge";

const SAMPLE = {
  agentId: "42",
  score: 78,
  recommendation: "ALLOW" as string,
  walletAge: "212d",
  x402Payments: "1,204",
  sybilRisk: "low",
};

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type DemoResponse = {
  live: boolean;
  agentId?: string;
  trustScore?: number;
  recommendation?: string;
  walletAgeDays?: number;
  x402PaymentCount?: number;
  sybilRisk?: string;
  scoredAt?: string;
};

type CardData = {
  live: boolean;
  agentId: string;
  score: number;
  recommendation: string;
  walletAge: string;
  x402Payments: string;
  sybilRisk: string;
  scoredAt?: string;
};

export function ScorePreviewCard() {
  const [data, setData] = useState<CardData>({ live: false, ...SAMPLE });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/demo/score")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: DemoResponse | null) => {
        if (cancelled || !json?.live) return;
        if (
          typeof json.trustScore !== "number" ||
          typeof json.agentId !== "string" ||
          typeof json.recommendation !== "string"
        ) {
          return;
        }
        setData({
          live: true,
          agentId: json.agentId,
          score: Math.max(0, Math.min(100, json.trustScore)),
          recommendation: json.recommendation,
          walletAge: `${json.walletAgeDays ?? 0}d`,
          x402Payments: (json.x402PaymentCount ?? 0).toLocaleString("en-US"),
          sybilRisk: json.sybilRisk ?? "low",
          scoredAt: json.scoredAt,
        });
      })
      .catch(() => {
        /* the static sample stays — never break the hero over a demo call */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const offset = CIRCUMFERENCE * (1 - data.score / 100);

  return (
    <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        {/* 2026-08-11: 差し色のシアンは「いま本物のチェーン状態を読んでいる」
            ことを示すこのラベルだけに使う。静的サンプル時は zinc のまま
            ＝色が状態を持つ（装飾ではない）。 */}
        <p
          className={`text-xs font-medium uppercase tracking-wide ${
            data.live ? "text-signal" : "text-zinc-500"
          }`}
        >
          {data.live ? "Live score · Base" : "Sample response"}
        </p>
        <VerdictBadge verdict={data.recommendation} />
      </div>

      <div className="mt-5 flex items-center gap-5">
        <div
          className="relative shrink-0"
          style={{ width: 88, height: 88 }}
          role="img"
          aria-label={`Trust score ${data.score} out of 100`}
        >
          <svg width={88} height={88} viewBox="0 0 96 96" className="-rotate-90" aria-hidden="true">
            <circle cx="48" cy="48" r={RADIUS} fill="none" stroke="#e4e4e7" strokeWidth="8" />
            <circle
              cx="48"
              cy="48"
              r={RADIUS}
              fill="none"
              stroke="var(--color-brand-deep)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 600ms ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="text-2xl font-semibold text-zinc-900">{data.score}</span>
          </div>
        </div>

        <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Item label="Agent ID" value={data.agentId} />
          <Item label="Wallet age" value={data.walletAge} />
          <Item label="x402 payments" value={data.x402Payments} />
          <Item label="Sybil risk" value={data.sybilRisk} />
        </dl>
      </div>

      <p className="mt-5 overflow-x-auto rounded-md bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-600">
        GET /api/v1/agents/{data.agentId}/score
      </p>
      {/* 2026-08-12 コントラスト是正: 下の注釈は zinc-400 (#A1A1AA) で、白地の
          実描画が 2.62:1 しかなく AA (4.5:1) を大きく割っていた。zinc-500 (#71717A)
          は白地 4.83:1。11px は太字18.66px未満なので大文字扱いにできず 4.5 が要る。 */}
      {data.live && data.scoredAt ? (
        <p className="mt-2 text-[11px] text-zinc-500">
          Computed from on-chain state at {new Date(data.scoredAt).toUTCString()} — this is a real
          registered agent, not a mock.
        </p>
      ) : null}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-900">{value}</dd>
    </div>
  );
}
