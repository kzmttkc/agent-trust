// ============================================================
// 既往 L1 決済の observed_purchases への遡及記帳（一回もの・冪等・既定 dry-run）。
//
// なぜ要るか: recordObservedPurchase は「trusted-writer ingest」として設計
// されながら呼び手が存在せず、observed_purchases は 0 行のままだった
// （本番実測 2026-08-22: observed_purchases 0行 / x402_l1_purchases 1,167行・
// うち status='settled' 496行）。呼び手は l1-runner に入れたので**これから**の
// 購入は自動で入るが、既往の決済は誰も書かない。
//
// 記帳の規則は l1-runner の実行時経路と厳密に同じ:
//   - 対象は status='settled' かつ tx_hash が非NULL の行だけ
//     （tx_hash は observed_purchases の自然キー・NOT NULL）;
//   - delivery_verified は http_status_paid=200 かつ payload_non_empty かつ
//     l2_schema <> 'mismatch' のときだけ true;
//   - block_timestamp には **pu.attempted_at**（購入を試みた実記録時刻）を入れる。
//     実行時経路は null のままでよい——その行の created_at は購入した瞬間だから。
//     だが遡及では created_at が「バックフィルを流した時刻」になり、reader の
//     `coalesce(block_timestamp, created_at)` が 8日分の履歴を1日に潰す
//     （uniqueDays はスコアの入力なので実害がある。2026-08-22 に実測で発見:
//     496行を入れた直後 uniqueDays=1）。attempted_at は推測ではなく台帳の記録値で、
//     決済ブロックとは数秒差。
// observed_by だけは 'observatory-l1-backfill:<endpoint_id>' と分ける——
// 遡及で入れた行と実時間で観測した行を後から区別できるようにするため。
//
// 冪等: tx_hash 一意 + recordObservedPurchase の ON CONFLICT DO NOTHING。
// 何度流しても増えない。
//
// 既定は dry-run。実行するには --execute を明示すること:
//   DATABASE_URL=... npx tsx scripts/backfill-observed-purchases.ts            # 数えるだけ
//   DATABASE_URL=... npx tsx scripts/backfill-observed-purchases.ts --execute  # 書く
// ============================================================
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { recordObservedPurchase } from "@/lib/db/observed-purchases";
import { isDeliveryVerified } from "@/lib/observatory/l1-runner";

type Row = {
  endpoint_id: string;
  payer: string | null;
  pay_to: string | null;
  amount_units: string | null;
  tx_hash: string | null;
  resource_url: string | null;
  http_status_paid: number | null;
  payload_non_empty: boolean | null;
  l2_schema: string | null;
  attempted_at: string | Date | null;
};

async function main() {
  const execute = process.argv.includes("--execute");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  const raw = await db.execute(sql`
    SELECT pu.endpoint_id::text AS endpoint_id, pu.payer, pu.pay_to, pu.amount_units,
           pu.tx_hash, e.resource_url, pu.http_status_paid, pu.payload_non_empty, pu.l2_schema,
           pu.attempted_at
    FROM x402_l1_purchases pu
    LEFT JOIN x402_endpoints e ON e.id = pu.endpoint_id
    WHERE pu.status = 'settled' AND pu.tx_hash IS NOT NULL AND pu.tx_hash <> ''
    ORDER BY pu.attempted_at ASC
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Row[];

  let created = 0;
  let alreadyPresent = 0;
  let unwritable = 0;
  let delivered = 0;
  for (const row of rows) {
    // wallet は NOT NULL。payer が無い行は「誰が買ったか」を名指せないので
    // 推測で埋めず報告に回す。
    if (!row.payer || !row.tx_hash) {
      unwritable++;
      continue;
    }
    // 規則は実行時経路と**同じ関数**を使う。ここで書き写すと、遡及で入れた行と
    // 実時間で観測した行が将来こっそり食い違う（2026-08-22 監査で指摘した
    // 「同じ規則の2実装」そのもの）。l2_schema の NULL は runner 側の既定に
    // 合わせて "no_declaration" 扱い——申告が無いことは配送の失敗ではない。
    const deliveryVerified = isDeliveryVerified({
      httpStatusPaid: row.http_status_paid,
      payloadNonEmpty: row.payload_non_empty === true,
      l2Schema: row.l2_schema ?? "no_declaration",
    });
    if (deliveryVerified) delivered++;
    if (!execute) continue;
    const result = await recordObservedPurchase({
      wallet: row.payer,
      counterparty: row.pay_to,
      amount: row.amount_units,
      txHash: row.tx_hash,
      resource: row.resource_url,
      blockTimestamp: row.attempted_at ? new Date(row.attempted_at) : null,
      deliveryVerified,
      observedBy: `observatory-l1-backfill:${row.endpoint_id}`,
    });
    if (result.created) created++;
    else alreadyPresent++;
  }

  // 既に入っている遡及行のうち block_timestamp が空のものを台帳の値へ是正する。
  // （最初の投入で null のまま入れてしまった分の自己修復。実行時経路が書いた行は
  //  observed_by が違うので触らない。）
  let repaired = 0;
  if (execute) {
    const fixed = await db.execute(sql`
      UPDATE observed_purchases op
      SET block_timestamp = pu.attempted_at
      FROM x402_l1_purchases pu
      WHERE op.tx_hash = lower(pu.tx_hash)
        AND op.block_timestamp IS NULL
        AND op.observed_by LIKE 'observatory-l1-backfill:%'
        AND pu.attempted_at IS NOT NULL
      RETURNING op.id
    `);
    repaired = (Array.isArray(fixed) ? fixed : (fixed as { rows?: unknown[] }).rows ?? []).length;
  }

  console.log(
    `${execute ? "" : "[dry-run] "}candidates=${rows.length} deliveryVerified=${delivered} ` +
      `unwritable=${unwritable}` +
      (execute
        ? ` created=${created} alreadyPresent=${alreadyPresent} blockTimestampRepaired=${repaired}`
        : " (--execute で書き込み)"),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
