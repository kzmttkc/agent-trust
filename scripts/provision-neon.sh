#!/usr/bin/env bash
set -euo pipefail

# Creates Neon project + database and prints pooled DATABASE_URL.
# Requires: npx neonctl (authenticated via `npx neonctl auth`)

PROJECT_NAME="${NEON_PROJECT_NAME:-vouch-agent-trust}"
DB_NAME="${NEON_DATABASE_NAME:-vouch}"

echo "==> Creating Neon project: $PROJECT_NAME"
PROJECT_ID=$(npx neonctl projects create --name "$PROJECT_NAME" --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['project']['id'])")

echo "==> Creating database: $DB_NAME"
npx neonctl databases create --project-id "$PROJECT_ID" --name "$DB_NAME" >/dev/null

echo "==> Fetching pooled connection string"
DATABASE_URL=$(npx neonctl connection-string "$DB_NAME" --project-id "$PROJECT_ID" --pooled)

echo "DATABASE_URL=$DATABASE_URL"
echo ""
echo "Next: npm run db:push (with DATABASE_URL exported)"
