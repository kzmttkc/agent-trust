#!/usr/bin/env bash
set -euo pipefail

# Push production env vars to Vercel (values via environment).
# Required: DATABASE_URL, API_KEY_PEPPER, DASHBOARD_SESSION_SECRET, ADMIN_SECRET, CRON_SECRET

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

add_env() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing $name" >&2
    exit 1
  fi
  printf '%s' "$value" | vercel env add "$name" production --force >/dev/null
  echo "set $name"
}

: "${DATABASE_URL:?DATABASE_URL required}"
: "${API_KEY_PEPPER:?API_KEY_PEPPER required}"
: "${DASHBOARD_SESSION_SECRET:?DASHBOARD_SESSION_SECRET required}"
: "${ADMIN_SECRET:?ADMIN_SECRET required}"
: "${CRON_SECRET:?CRON_SECRET required}"

add_env APP_ENV production
add_env DATABASE_URL "$DATABASE_URL"
add_env API_KEY_PEPPER "$API_KEY_PEPPER"
add_env DASHBOARD_SESSION_SECRET "$DASHBOARD_SESSION_SECRET"
add_env ADMIN_SECRET "$ADMIN_SECRET"
add_env CRON_SECRET "$CRON_SECRET"
add_env BASE_RPC_URL "${BASE_RPC_URL:-https://mainnet.base.org}"
add_env TRUST_PROXY_HEADERS "${TRUST_PROXY_HEADERS:-true}"
add_env BLOCKSCOUT_API_URL "${BLOCKSCOUT_API_URL:-https://base.blockscout.com/api}"

if [[ -n "${BETA_INVITE_CODE:-}" ]]; then
  add_env BETA_INVITE_CODE "$BETA_INVITE_CODE"
fi

if [[ -n "${STRIPE_SECRET_KEY:-}" ]]; then
  add_env STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
fi
if [[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  add_env STRIPE_WEBHOOK_SECRET "$STRIPE_WEBHOOK_SECRET"
fi
if [[ -n "${STRIPE_PRICE_PRO:-}" ]]; then
  add_env STRIPE_PRICE_PRO "$STRIPE_PRICE_PRO"
fi
if [[ -n "${STRIPE_PRICE_SCALE:-}" ]]; then
  add_env STRIPE_PRICE_SCALE "$STRIPE_PRICE_SCALE"
fi
if [[ -n "${NEXT_PUBLIC_APP_URL:-}" ]]; then
  add_env NEXT_PUBLIC_APP_URL "$NEXT_PUBLIC_APP_URL"
fi

echo "Vercel production env configured."
