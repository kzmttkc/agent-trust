#!/usr/bin/env bash
# Free ops smoke checks for Hobby deploy (no paid uptime SaaS required).
# Usage:
#   ./scripts/smoke-production.sh
#   CRON_SECRET=... ./scripts/smoke-production.sh   # also hits monitor-health
set -euo pipefail

PROD_URL="${PROD_URL:-https://agent-trust-tawny.vercel.app}"

echo "==> health"
curl -fsS "$PROD_URL/api/health" | tee /tmp/vouch-health.json
echo

echo "==> docs/api"
code=$(curl -sS -o /dev/null -w "%{http_code}" "$PROD_URL/docs/api")
test "$code" = "200"
echo "ok ($code)"

if [[ -n "${CRON_SECRET:-}" ]]; then
  echo "==> monitor-health"
  code=$(curl -sS -o /tmp/vouch-monitor.json -w "%{http_code}" \
    -H "Authorization: Bearer $CRON_SECRET" \
    "$PROD_URL/api/cron/monitor-health")
  echo "http $code"
  cat /tmp/vouch-monitor.json
  echo
  case "$code" in
    200|503) ;;
    401|403)
      echo "warn: CRON_SECRET rejected (health endpoints above still ok)"
      ;;
    *)
      echo "unexpected monitor-health status: $code" >&2
      exit 1
      ;;
  esac
else
  echo "==> monitor-health skipped (set CRON_SECRET to probe)"
fi

echo "smoke ok"
