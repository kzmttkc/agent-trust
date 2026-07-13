/**
 * Validates required production environment variables before deploy.
 * Usage: APP_ENV=production DATABASE_URL=... ... npm run check:env
 */

import {
  collectProductionEnvIssues,
  getProductionEnvErrors,
} from "../src/lib/config/production-env";

function main() {
  if (process.env.APP_ENV !== "production") {
    console.log("APP_ENV is not production — skipping strict checks.");
    process.exit(0);
  }

  const errors = getProductionEnvErrors();
  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`ERROR: ${message}`);
    }
    process.exit(1);
  }

  for (const issue of collectProductionEnvIssues()) {
    if (issue.level === "warn") {
      console.warn(`WARN: ${issue.message}`);
    }
  }

  console.log("Production environment checks passed.");
}

main();
