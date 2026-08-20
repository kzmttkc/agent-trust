// ============================================================
// db:push / db:generate の前に必ず走る接続先ガード。
//
// 2026-08-14、本番と同一Neonホスト上の別database「neondb」へ migration が
// 誤適用された（state/ALERTS.md 記載）。本番databaseは「vouch」。
// .env の URL 末尾ひとつで無音のまま別DBへスキーマが流れる事故だったので、
// 規律ではなく機械で止める——Neonホスト向けの実行は database 名が
// 「vouch」であることを、URL文字列と実接続の両方で assert する。
//
// ローカル開発DB（docker-compose の vouch@localhost）や CI の一時DBは
// Neonホストではないため素通しする。ここで守るのは本番だけ。
// ============================================================
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db-preflight: DATABASE_URL is not set");
  process.exit(1);
}

let parsed: URL;
try {
  parsed = new URL(url);
} catch {
  console.error("db-preflight: DATABASE_URL is not a parseable URL");
  process.exit(1);
}

const dbName = parsed.pathname.replace(/^\//, "");
const isNeon = parsed.hostname.endsWith(".neon.tech");

if (isNeon && dbName !== "vouch") {
  console.error(
    `db-preflight: refusing Neon database "${dbName}" — production database is "vouch" (2026-08-14 neondb 誤適用の再発防止)`,
  );
  process.exit(1);
}

// URL が正しくても接続先が別物なら意味がない（測定器自体を検証する）。
// 実接続で current_database() を読んで突き合わせる。
async function main() {
  const sql = postgres(url!, { max: 1, connect_timeout: 10 });
  try {
    const [row] = await sql`SELECT current_database() AS db`;
    if (isNeon && row.db !== "vouch") {
      console.error(`db-preflight: connected database is "${row.db}", expected "vouch"`);
      process.exit(1);
    }
    console.log(`db-preflight: OK (${row.db}${isNeon ? " on Neon" : ""})`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`db-preflight: connection check failed — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
