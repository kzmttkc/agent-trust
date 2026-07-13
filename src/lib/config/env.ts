import { getProductionEnvErrors } from "./production-env";

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

let validated = false;

/**
 * Fail fast on boot when production env is incomplete or unsafe.
 * Mirrors scripts/check-production-env.ts (single source of truth).
 */
export function assertProductionConfig(): void {
  // Soft-prod trap: Vercel-like NODE_ENV=production with APP_ENV=development|test.
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.APP_ENV === "development" || process.env.APP_ENV === "test")
  ) {
    throw new Error(
      "APP_ENV=development|test is not allowed when NODE_ENV=production (mislabeled deploy)",
    );
  }

  if (!isProduction()) return;

  if (process.env.APP_ENV !== "production") {
    throw new Error("APP_ENV must be set to production in production deployments");
  }

  const errors = getProductionEnvErrors();
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export function ensureProductionConfig(): void {
  if (validated) return;
  assertProductionConfig();
  validated = true;
}

export function secureCookiesEnabled(): boolean {
  if (isProduction()) return true;
  if (process.env.FORCE_SECURE_COOKIES === "true") return true;
  return false;
}

export { getProductionEnvErrors, getProductionEnvWarnings } from "./production-env";
