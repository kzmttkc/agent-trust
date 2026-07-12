import { purgeExpiredLogs } from "../src/lib/cron/log-retention";

async function main() {
  const result = await purgeExpiredLogs();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
