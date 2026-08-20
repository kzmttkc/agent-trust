// ============================================================
// 日次メトリクスのロールアップ（Phase 1.1）。
//
// raw（x402_l0_probes / x402_l1_purchases）を UTC 日 × チェーンで集計し、
// x402_daily_metrics へ冪等 upsert する。1文の INSERT ... SELECT ... ON
// CONFLICT DO UPDATE で書くのは l1-runner.reserveSpend と同じ理由——
// 読んでから書く形にすると並行実行（cron と backfill の重なり）で
// 半端な合成が起き得る。ここは事実のキャッシュであり、いつでも raw から
// 再導出できる（正本は raw）。
//
// chain は endpoint の network 申告をそのまま使い、未申告は "unknown"。
// 申告が無いことを集計から黙って消さない（facts with denominators）。
// ============================================================
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Aggregate one UTC day from the raw tables into x402_daily_metrics. */
export async function rollupDailyMetrics(day: string): Promise<void> {
  if (!DAY_RE.test(day)) throw new Error(`rollupDailyMetrics: not a YYYY-MM-DD day: ${day}`);
  const db = getDb();
  if (!db) throw new Error("rollupDailyMetrics: DATABASE_URL is not configured");

  await db.execute(sql`
    INSERT INTO x402_daily_metrics (day, chain, l0_probes, l0_pass, l1_attempts, l1_settled, spent_units, updated_at)
    SELECT
      ${day} AS day,
      chain,
      coalesce(sum(l0_probes), 0)::int,
      coalesce(sum(l0_pass), 0)::int,
      coalesce(sum(l1_attempts), 0)::int,
      coalesce(sum(l1_settled), 0)::int,
      coalesce(sum(spent_units), 0)::text,
      now()
    FROM (
      SELECT
        coalesce(e.network, 'unknown') AS chain,
        count(*) AS l0_probes,
        count(*) FILTER (WHERE p.verdict = 'pass') AS l0_pass,
        0 AS l1_attempts, 0 AS l1_settled, 0::numeric AS spent_units
      FROM x402_l0_probes p
      JOIN x402_endpoints e ON e.id = p.endpoint_id
      WHERE p.probed_at >= ${day}::date AND p.probed_at < ${day}::date + interval '1 day'
      GROUP BY 1
      UNION ALL
      SELECT
        -- L1のchainは「実際に支払ったレール」（pu.network＝acceptの網）。
        -- カタログ申告網で数えると、Solana申告の壁にBaseレールで払った決済が
        -- Solana実績に見える（2026-08-20 助成金提案書の検算で実際に25件検出）。
        -- 旧行（pu.network無し）だけ申告網へフォールバック。
        coalesce(pu.network, e.network, 'unknown') AS chain,
        0, 0,
        count(*) AS l1_attempts,
        count(*) FILTER (WHERE pu.status = 'settled') AS l1_settled,
        coalesce(sum(pu.spent_units::numeric), 0) AS spent_units
      FROM x402_l1_purchases pu
      JOIN x402_endpoints e ON e.id = pu.endpoint_id
      WHERE pu.attempted_at >= ${day}::date AND pu.attempted_at < ${day}::date + interval '1 day'
      GROUP BY 1
    ) parts
    GROUP BY chain
    ON CONFLICT (day, chain) DO UPDATE SET
      l0_probes = EXCLUDED.l0_probes,
      l0_pass = EXCLUDED.l0_pass,
      l1_attempts = EXCLUDED.l1_attempts,
      l1_settled = EXCLUDED.l1_settled,
      spent_units = EXCLUDED.spent_units,
      updated_at = EXCLUDED.updated_at
  `);
}

export type DailyMetricsRow = {
  day: string;
  chain: string;
  l0Probes: number;
  l0Pass: number;
  l1Attempts: number;
  l1Settled: number;
  spentUnits: string;
};

/**
 * History for the public API/page, newest day last. Bounded (≤ 366 days) —
 * this feeds a key-less endpoint, so the caller never controls an unbounded
 * scan.
 */
export async function getDailyMetricsHistory(days: number): Promise<DailyMetricsRow[]> {
  const span = Math.min(Math.max(Math.trunc(days) || 0, 1), 366);
  const db = getDb();
  if (!db) return [];
  const raw = await db.execute(sql`
    SELECT day, chain, l0_probes, l0_pass, l1_attempts, l1_settled, spent_units
    FROM x402_daily_metrics
    WHERE day >= to_char((now() AT TIME ZONE 'utc')::date - ${span}::int, 'YYYY-MM-DD')
    ORDER BY day ASC, chain ASC
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    day: String(r.day),
    chain: String(r.chain),
    l0Probes: Number(r.l0_probes),
    l0Pass: Number(r.l0_pass),
    l1Attempts: Number(r.l1_attempts),
    l1Settled: Number(r.l1_settled),
    spentUnits: String(r.spent_units),
  }));
}
