/**
 * ScorePreviewCard — static illustrative preview of a /score API response,
 * shown on the marketing homepage. Not a live lookup (that's
 * /dashboard/lookup) — just gives a visitor a concrete sense of the shape
 * and content of a trust score before they sign up.
 */

const SAMPLE = {
  agentId: "42",
  score: 78,
  recommendation: "ALLOW" as const,
  walletAge: "212d",
  x402Payments: "1,204",
  sybilRisk: "low",
};

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScorePreviewCard() {
  const offset = CIRCUMFERENCE * (1 - SAMPLE.score / 100);

  return (
    <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Sample response</p>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
          {SAMPLE.recommendation}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-5">
        <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
          <svg width={88} height={88} viewBox="0 0 96 96" className="-rotate-90">
            <circle cx="48" cy="48" r={RADIUS} fill="none" stroke="#e4e4e7" strokeWidth="8" />
            <circle
              cx="48"
              cy="48"
              r={RADIUS}
              fill="none"
              stroke="#18181b"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-semibold text-zinc-900">{SAMPLE.score}</span>
          </div>
        </div>

        <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <Item label="Agent ID" value={SAMPLE.agentId} />
          <Item label="Wallet age" value={SAMPLE.walletAge} />
          <Item label="x402 payments" value={SAMPLE.x402Payments} />
          <Item label="Sybil risk" value={SAMPLE.sybilRisk} />
        </dl>
      </div>

      <p className="mt-5 overflow-x-auto rounded-md bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-600">
        GET /api/v1/agents/{SAMPLE.agentId}/score
      </p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="font-mono text-zinc-900">{value}</dd>
    </div>
  );
}
