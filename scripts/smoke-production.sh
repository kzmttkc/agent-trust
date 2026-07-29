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
      # fail-loud: a rejected CRON_SECRET means runDeepHealthChecks never runs,
      # so the deep probe is DOWN. Do not report this as OK — that was the
      # 2026-07-29 "fake OK" bug where a mismatched secret masked real outages.
      echo "FAIL: monitor-health rejected CRON_SECRET (http $code) — deep health checks are NOT running" >&2
      exit 1
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
