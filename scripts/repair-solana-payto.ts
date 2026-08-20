// ============================================================
// 既往カタログ行の payTo 修復（Phase 1.2・一回もの・冪等）。
//
// 2026-08-20 まで catalog-sync が payTo を無条件小文字化しており、base58
// （Solana / Algorand）のアドレスは大文字小文字が情報なので破壊されていた。
// 原本は同じ行の raw_accepts（受信した accepts[] をそのまま保存）に生きて
// いる。ここから accepts[0].payTo / recipient を読み直して復元する。
//
// 冪等: 復元値と現値が同じ行は触らない。0x（EVM）行は対象外。
// Run: DATABASE_URL=... npx tsx scripts/repair-solana-payto.ts [--dry-run]
// ============================================================
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");

  const raw = await db.execute(sql`
    SELECT id, pay_to, raw_accepts
    FROM x402_endpoints
    WHERE pay_to IS NOT NULL AND pay_to NOT LIKE '0x%'
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as {
    id: string;
    pay_to: string;
    raw_accepts: unknown;
  }[];

  let repaired = 0;
  let unrecoverable = 0;
  let alreadyOk = 0;
  for (const row of rows) {
    const accepts = Array.isArray(row.raw_accepts) ? row.raw_accepts : [];
    const first = accepts[0] as { payTo?: unknown; recipient?: unknown } | undefined;
    const original =
      typeof first?.payTo === "string" && first.payTo !== ""
        ? first.payTo
        : typeof first?.recipient === "string" && first.recipient !== ""
          ? first.recipient
          : null;
    if (!original) {
      unrecoverable++;
      continue;
    }
    if (original === row.pay_to) {
      alreadyOk++;
      continue;
    }
    if (original.toLowerCase() !== row.pay_to.toLowerCase()) {
      // raw と現値が大小無視でも一致しない＝別の受取先が保存されている。
      // 黙って上書きせず報告に回す（測定器の検証）。
      console.error(`MISMATCH beyond casing: ${row.id} stored=${row.pay_to} raw=${original}`);
      unrecoverable++;
      continue;
    }
    if (!dryRun) {
      await db.execute(sql`UPDATE x402_endpoints SET pay_to = ${original} WHERE id = ${row.id}::uuid`);
    }
    repaired++;
  }
  console.log(
    `${dryRun ? "[dry-run] " : ""}repaired=${repaired} alreadyOk=${alreadyOk} unrecoverable=${unrecoverable} scanned=${rows.length}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
