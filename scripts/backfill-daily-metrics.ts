// ============================================================
// x402_daily_metrics の全既往日 backfill（Phase 1.1・一回もの・冪等）。
// raw の最古の probe/purchase 日から今日まで rollupDailyMetrics を回す。
// Run: DATABASE_URL=... npx tsx scripts/backfill-daily-metrics.ts
// ============================================================
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rollupDailyMetrics } from "@/lib/observatory/metrics-rollup";

async function main() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  const raw = await db.execute(sql`
    SELECT to_char(least(
      coalesce((SELECT min(probed_at) FROM x402_l0_probes), now()),
      coalesce((SELECT min(attempted_at) FROM x402_l1_purchases), now())
    )::date, 'YYYY-MM-DD') AS first_day
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as {
    first_day: string;
  }[];
  const firstDay = rows[0]?.first_day;
  if (!firstDay) throw new Error("could not determine first day");

  const start = new Date(`${firstDay}T00:00:00Z`).getTime();
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  for (let t = start; ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    await rollupDailyMetrics(day);
    count++;
    if (day >= today) break;
  }
  console.log(`backfilled ${count} days (${firstDay} .. ${today})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
