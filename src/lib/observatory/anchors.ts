// ============================================================
// 台帳ハッシュチェーン（TEE設計 docs/tee-zk-integrity.md Stage 0）。
//
// 何を固定するか: その UTC 日の全 L1 行（全 status・主キー昇順）を安定した
// 射影で正規化JSONにし、前日の root を先頭に連結して sha256 を取る。
// 過去のどの行を書き換えても、その日以降の全 root が検算で崩れる——
// 「この記録がこの時点で存在した」を第三者が末尾から検証できる。
//
// 誰でも再計算できることが価値なので、射影・順序・連結規則はこのファイルが
// 正典（変更は root の断絶を意味する。変更するなら新チェーンとして明示）。
//
// オンチェーンへの刻印（anchored_tx）は ANCHOR_WRITES_ENABLED（既定OFF・
// ガス代）。刻印済みの日の root は**いかなる理由でも上書きしない**——
// 食い違いは conflict_frozen として返し、呼び手（cron）が ALERT に出す。
// ============================================================
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isAnchorWritesEnabled(): boolean {
  return process.env.ANCHOR_WRITES_ENABLED === "true";
}

type Db = NonNullable<ReturnType<typeof getDb>>;

/** その日の正規化ペイロード（決定的・主キー昇順）。 */
async function canonicalDayPayload(db: Db, day: string): Promise<{ payload: string; count: number }> {
  const raw = await db.execute(sql`
    SELECT pu.id::text AS id, pu.endpoint_id::text AS endpoint_id,
           to_char(pu.attempted_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS attempted_at,
           pu.status, pu.network, pu.asset, pu.pay_to, pu.amount_units, pu.spent_units,
           pu.payer, pu.tx_hash, pu.http_status_paid, pu.latency_ms, pu.l2_schema
    FROM x402_l1_purchases pu
    WHERE pu.attempted_at >= ${day}::date AND pu.attempted_at < ${day}::date + interval '1 day'
    ORDER BY pu.id ASC
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
    string,
    unknown
  >[];
  return { payload: JSON.stringify({ v: 1, day, rows }), count: rows.length };
}

export type AnchorResult = {
  day: string;
  rootHash: string;
  entryCount: number;
  /** created | unchanged | updated | conflict_frozen */
  status: "created" | "unchanged" | "updated" | "conflict_frozen";
};

/**
 * 1日ぶんの root を計算して upsert。冪等。
 * 前日 root は DB の連鎖から取る（無ければ genesis = 空文字連結）。
 */
export async function anchorDay(day: string): Promise<AnchorResult> {
  if (!DAY_RE.test(day)) throw new Error(`anchorDay: not a YYYY-MM-DD day: ${day}`);
  const db = getDb();
  if (!db) throw new Error("anchorDay: DATABASE_URL is not configured");

  const { payload, count } = await canonicalDayPayload(db, day);
  const prevRaw = await db.execute(sql`
    SELECT root_hash FROM ledger_anchors WHERE day < ${day} ORDER BY day DESC LIMIT 1
  `);
  const prevRows = (Array.isArray(prevRaw) ? prevRaw : (prevRaw as { rows?: unknown[] }).rows ?? []) as {
    root_hash: string;
  }[];
  const prevRoot = prevRows[0]?.root_hash ?? null;
  const rootHash = createHash("sha256")
    .update(prevRoot ?? "genesis")
    .update("\n")
    .update(payload)
    .digest("hex");

  const existingRaw = await db.execute(sql`
    SELECT root_hash, anchored_tx FROM ledger_anchors WHERE day = ${day}
  `);
  const existing = (Array.isArray(existingRaw)
    ? existingRaw
    : (existingRaw as { rows?: unknown[] }).rows ?? []) as {
    root_hash: string;
    anchored_tx: string | null;
  }[];

  if (existing.length === 0) {
    await db.execute(sql`
      INSERT INTO ledger_anchors (day, root_hash, prev_root, entry_count)
      VALUES (${day}, ${rootHash}, ${prevRoot}, ${count})
      ON CONFLICT (day) DO NOTHING
    `);
    return { day, rootHash, entryCount: count, status: "created" };
  }
  if (existing[0].root_hash === rootHash) {
    return { day, rootHash, entryCount: count, status: "unchanged" };
  }
  if (existing[0].anchored_tx) {
    // 刻印済み root と現データが食い違う＝整合性イベント。書き換えない。
    return { day, rootHash: existing[0].root_hash, entryCount: count, status: "conflict_frozen" };
  }
  // 未刻印なら同日中の遅延到着行を取り込んで更新（連鎖の先頭は常に最新日なので安全）。
  await db.execute(sql`
    UPDATE ledger_anchors SET root_hash = ${rootHash}, prev_root = ${prevRoot}, entry_count = ${count}
    WHERE day = ${day}
  `);
  return { day, rootHash, entryCount: count, status: "updated" };
}

export type AnchorRow = {
  day: string;
  rootHash: string;
  prevRoot: string | null;
  entryCount: number;
  anchoredTx: string | null;
};

export async function getAnchors(days: number): Promise<AnchorRow[]> {
  const span = Math.min(Math.max(Math.trunc(days) || 0, 1), 366);
  const db = getDb();
  if (!db) return [];
  const raw = await db.execute(sql`
    SELECT day, root_hash, prev_root, entry_count, anchored_tx
    FROM ledger_anchors ORDER BY day DESC LIMIT ${span}
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    day: String(r.day),
    rootHash: String(r.root_hash),
    prevRoot: r.prev_root === null ? null : String(r.prev_root),
    entryCount: Number(r.entry_count),
    anchoredTx: r.anchored_tx === null ? null : String(r.anchored_tx),
  }));
}
