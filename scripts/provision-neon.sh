#!/usr/bin/env bash
set -euo pipefail

# Creates Neon project + database and prints pooled DATABASE_URL.
# Requires: npx neonctl (authenticated via `npx neonctl auth`)

PROJECT_NAME="${NEON_PROJECT_NAME:-vouch-agent-trust}"
DB_NAME="${NEON_DATABASE_NAME:-vouch}"
ORG_ID="${NEON_ORG_ID:-}"

echo "==> Creating Neon project: $PROJECT_NAME"
CREATE_ARGS=(--name "$PROJECT_NAME" --output json)
if [[ -n "$ORG_ID" ]]; then
  CREATE_ARGS+=(--org-id "$ORG_ID")
fi

PROJECT_ID=$(npx neonctl projects create "${CREATE_ARGS[@]}" | python3 -c "import sys,json; print(json.load(sys.stdin)['project']['id'])")

echo "==> Creating database: $DB_NAME"
npx neonctl databases create --project-id "$PROJECT_ID" --name "$DB_NAME" >/dev/null || true

echo "==> Fetching pooled connection string"
DATABASE_URL=$(npx neonctl connection-string main --project-id "$PROJECT_ID" --database-name "$DB_NAME" --pooled)

echo "DATABASE_URL=$DATABASE_URL"
echo "NEON_PROJECT_ID=$PROJECT_ID"
