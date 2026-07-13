#!/usr/bin/env bash
set -euo pipefail

# Trigger production cron jobs (uses Alchemy RPC on Vercel).
# Usage: CRON_SECRET=... ./scripts/trigger-production-cron.sh [index-owners|index-funders|purge-logs]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${CRON_SECRET:?CRON_SECRET required}"
PROD_URL="${PROD_URL:-https://agent-trust-tawny.vercel.app}"
JOB="${1:-index-owners}"

case "$JOB" in
  index-owners)
    for i in $(seq 1 10); do
      echo "==> $JOB run $i"
      RES=$(curl -s -m 280 -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/$JOB")
      echo "$RES"
      echo "$RES" | grep -q '"caughtUp":true' && break
      sleep 3
    done
    ;;
  index-funders|purge-logs)
    curl -s -m 120 -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/$JOB"
    echo ""
    ;;
  *)
    echo "Unknown job: $JOB" >&2
    exit 1
    ;;
esac
