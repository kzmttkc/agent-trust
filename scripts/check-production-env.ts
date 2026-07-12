/**
 * Validates required production environment variables before deploy.
 * Usage: APP_ENV=production DATABASE_URL=... ... npx tsx scripts/check-production-env.ts
 */

const WEAK = /^change_me|^dev_|^test_|^password$|^secret$/i;

function check(name: string, minLength = 1): void {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`${name} is missing or too short (min ${minLength})`);
  }
  if (WEAK.test(value)) {
    throw new Error(`${name} must not use a placeholder value`);
  }
}

function main() {
  if (process.env.APP_ENV !== "production") {
    console.log("APP_ENV is not production — skipping strict checks.");
    process.exit(0);
  }

  const required = [
    ["DATABASE_URL", 16],
    ["API_KEY_PEPPER", 32],
    ["DASHBOARD_SESSION_SECRET", 32],
    ["ADMIN_SECRET", 32],
    ["CRON_SECRET", 32],
    ["BASE_RPC_URL", 8],
  ] as const;

  for (const [name, min] of required) {
    check(name, min);
  }

  if (process.env.DEV_API_KEY) {
    throw new Error("DEV_API_KEY must not be set in production");
  }

  if (process.env.SKIP_CHAIN_READS === "true") {
    throw new Error("SKIP_CHAIN_READS must not be enabled in production");
  }

  if (!process.env.TRUST_PROXY_HEADERS) {
    console.warn("WARN: TRUST_PROXY_HEADERS is not set — IP rate limits may map to 'unknown'.");
  }

  console.log("Production environment checks passed.");
}

main();
