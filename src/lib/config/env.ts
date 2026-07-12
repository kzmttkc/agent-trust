const WEAK_SECRET_PATTERNS = [
  /^change_me/i,
  /^dev_/i,
  /^test_/i,
  /^password$/i,
  /^secret$/i,
];

export type AppEnv = "development" | "production" | "test";

export function getAppEnv(): AppEnv {
  const explicit = process.env.APP_ENV;
  if (explicit === "production" || explicit === "development" || explicit === "test") {
    return explicit;
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function isProduction(): boolean {
  return getAppEnv() === "production";
}

export function isDevelopment(): boolean {
  return getAppEnv() === "development";
}

export function isDevApiKeyEnabled(): boolean {
  return Boolean(process.env.DEV_API_KEY) && !isProduction();
}

export function isSkipChainReadsEnabled(): boolean {
  return process.env.SKIP_CHAIN_READS === "true" && !isProduction();
}

function assertSecret(name: string, value: string | undefined, minLength = 32): void {
  if (!value || value.length < minLength) {
    throw new Error(`${name} is required in production (min ${minLength} chars)`);
  }
  if (WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${name} must not use a default or placeholder value in production`);
  }
}

let validated = false;

export function assertProductionConfig(): void {
  if (!isProduction()) return;

  if (process.env.APP_ENV !== "production") {
    throw new Error("APP_ENV must be set to production in production deployments");
  }

  if (process.env.DATABASE_URL && !process.env.APP_ENV) {
    throw new Error("APP_ENV must be set explicitly when DATABASE_URL is configured");
  }

  if (process.env.DEV_API_KEY) {
    throw new Error("DEV_API_KEY must not be set in production");
  }

  if (process.env.SKIP_CHAIN_READS === "true") {
    throw new Error("SKIP_CHAIN_READS must not be enabled in production");
  }

  assertSecret("API_KEY_PEPPER", process.env.API_KEY_PEPPER);
  assertSecret("DASHBOARD_SESSION_SECRET", process.env.DASHBOARD_SESSION_SECRET);
  assertSecret("ADMIN_SECRET", process.env.ADMIN_SECRET);
  assertSecret("DATABASE_URL", process.env.DATABASE_URL, 16);
}

export function ensureProductionConfig(): void {
  if (validated) return;
  validated = true;
  assertProductionConfig();
}

export function secureCookiesEnabled(): boolean {
  if (isProduction()) return true;
  if (process.env.FORCE_SECURE_COOKIES === "true") return true;
  return false;
}
