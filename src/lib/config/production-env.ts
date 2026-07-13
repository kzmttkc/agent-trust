import { hasLowEntropy, WEAK_SECRET_PATTERNS } from "./env-secrets";

export type ProductionEnvIssue = {
  level: "error" | "warn";
  message: string;
};

/** Required in production per docs/deployment.md */
export const PRODUCTION_REQUIRED_STRING_VARS = [
  ["DATABASE_URL", 16],
  ["API_KEY_PEPPER", 32],
  ["DASHBOARD_SESSION_SECRET", 32],
  ["ADMIN_SECRET", 32],
  ["CRON_SECRET", 32],
  ["BASE_RPC_URL", 8],
] as const;

function isWeakSecret(value: string): boolean {
  return WEAK_SECRET_PATTERNS.some((pattern) => pattern.test(value)) || hasLowEntropy(value);
}

function validateRequiredString(
  name: string,
  value: string | undefined,
  minLength: number,
): ProductionEnvIssue | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < minLength) {
    return {
      level: "error",
      message: `${name} is required in production (min ${minLength} chars, non-empty)`,
    };
  }
  if (isWeakSecret(trimmed)) {
    return {
      level: "error",
      message: `${name} must not use a default, placeholder, or low-entropy value in production`,
    };
  }
  return null;
}

function validateBaseRpcUrl(value: string | undefined): ProductionEnvIssue | null {
  const base = validateRequiredString("BASE_RPC_URL", value, 8);
  if (base) return base;

  const trimmed = value!.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        level: "error",
        message: "BASE_RPC_URL must be an http(s) URL in production",
      };
    }
  } catch {
    return {
      level: "error",
      message: "BASE_RPC_URL must be a valid URL in production",
    };
  }

  return null;
}

/**
 * Collect production env validation issues without throwing.
 * Used by deploy scripts, deep health, and startup guards.
 */
export function collectProductionEnvIssues(): ProductionEnvIssue[] {
  const issues: ProductionEnvIssue[] = [];

  if (process.env.APP_ENV !== "production") {
    return issues;
  }

  for (const [name, min] of PRODUCTION_REQUIRED_STRING_VARS) {
    if (name === "BASE_RPC_URL") {
      const rpcIssue = validateBaseRpcUrl(process.env.BASE_RPC_URL);
      if (rpcIssue) issues.push(rpcIssue);
      continue;
    }

    const issue = validateRequiredString(name, process.env[name], min);
    if (issue) issues.push(issue);
  }

  if (process.env.DEV_API_KEY) {
    issues.push({
      level: "error",
      message: "DEV_API_KEY must not be set in production",
    });
  }

  if (process.env.SKIP_CHAIN_READS === "true") {
    issues.push({
      level: "error",
      message: "SKIP_CHAIN_READS must not be enabled in production",
    });
  }

  if (process.env.TRUST_PROXY_HEADERS !== "true") {
    issues.push({
      level: "error",
      message: "TRUST_PROXY_HEADERS must be set to true in production (use platform IP headers)",
    });
  }

  if (process.env.TRUST_GENERIC_FORWARDED_FOR === "true") {
    issues.push({
      level: "warn",
      message:
        "TRUST_GENERIC_FORWARDED_FOR=true trusts spoofable X-Forwarded-For — only enable behind a stripping proxy",
    });
  }

  const indexerRpc = process.env.INDEXER_RPC_URL?.trim();
  if (indexerRpc) {
    try {
      const url = new URL(indexerRpc);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issues.push({
          level: "error",
          message: "INDEXER_RPC_URL must be an http(s) URL when set",
        });
      }
    } catch {
      issues.push({
        level: "error",
        message: "INDEXER_RPC_URL must be a valid URL when set",
      });
    }
  }

  if (!process.env.BLOCKSCOUT_API_URL?.trim()) {
    issues.push({
      level: "warn",
      message: "BLOCKSCOUT_API_URL is not set — wallet metrics may be degraded",
    });
  }

  return issues;
}

export function getProductionEnvErrors(): string[] {
  return collectProductionEnvIssues()
    .filter((issue) => issue.level === "error")
    .map((issue) => issue.message);
}

export function getProductionEnvWarnings(): string[] {
  return collectProductionEnvIssues()
    .filter((issue) => issue.level === "warn")
    .map((issue) => issue.message);
}
