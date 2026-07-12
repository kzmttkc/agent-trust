#!/usr/bin/env bash
set -euo pipefail

# Finish Stripe public-beta setup after deploy.
# Usage:
#   STRIPE_SECRET_KEY=sk_test_... NEXT_PUBLIC_APP_URL=https://agent-trust-tawny.vercel.app \
#     ./scripts/complete-stripe-setup.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY required}"
: "${NEXT_PUBLIC_APP_URL:?NEXT_PUBLIC_APP_URL required}"

echo "==> Creating Stripe products/prices"
PRODUCTS_JSON=$(STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" npm run setup:stripe)
STRIPE_PRICE_PRO=$(echo "$PRODUCTS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['STRIPE_PRICE_PRO'])")
STRIPE_PRICE_SCALE=$(echo "$PRODUCTS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['STRIPE_PRICE_SCALE'])")

echo "==> Registering webhook"
WEBHOOK_JSON=$(STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" npm run setup:stripe-webhook)
STRIPE_WEBHOOK_SECRET=$(echo "$WEBHOOK_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('STRIPE_WEBHOOK_SECRET',''))")

if [[ -z "$STRIPE_WEBHOOK_SECRET" ]]; then
  echo "WARN: webhook secret not returned (existing endpoint). Set STRIPE_WEBHOOK_SECRET manually in Vercel." >&2
else
  export STRIPE_WEBHOOK_SECRET
fi

export STRIPE_PRICE_PRO STRIPE_PRICE_SCALE
export DATABASE_URL="${DATABASE_URL:-placeholder}"
export API_KEY_PEPPER="${API_KEY_PEPPER:-placeholder}"
export DASHBOARD_SESSION_SECRET="${DASHBOARD_SESSION_SECRET:-placeholder}"
export ADMIN_SECRET="${ADMIN_SECRET:-placeholder}"
export CRON_SECRET="${CRON_SECRET:-placeholder}"

echo "==> Pushing Stripe env to Vercel production"
STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" \
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}" \
STRIPE_PRICE_PRO="$STRIPE_PRICE_PRO" \
STRIPE_PRICE_SCALE="$STRIPE_PRICE_SCALE" \
NEXT_PUBLIC_APP_URL="$NEXT_PUBLIC_APP_URL" \
./scripts/vercel-env-production.sh

echo "==> Done. Redeploy: vercel deploy --prod"
