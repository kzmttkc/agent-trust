#!/usr/bin/env bash
set -euo pipefail

# Catch up owner-agent indexer on production (Vercel cron uses Alchemy RPC).
#
# Usage:
#   CRON_SECRET=... ./scripts/catch-up-owner-index.sh
#   CRON_SECRET=... MAX_RUNS=200 MAX_BLOCKS=500000 ./scripts/catch-up-owner-index.sh
#
# Local alternative (needs production DATABASE_URL + BASE_RPC_URL):
#   DATABASE_URL=... BASE_RPC_URL=... ./scripts/catch-up-owner-index.sh --local

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROD_URL="${PROD_URL:-https://agent-trust-tawny.vercel.app}"
MAX_RUNS="${MAX_RUNS:-200}"
MAX_BLOCKS="${MAX_BLOCKS:-500000}"
SLEEP_SEC="${SLEEP_SEC:-2}"
MODE="${1:-cron}"

run_local() {
  if [ -z "${DATABASE_URL:-}" ]; then
    if command -v npx >/dev/null 2>&1; then
      DATABASE_URL="$(npx neonctl connection-string main --project-id small-sun-02943444 --database-name vouch --pooled 2>/dev/null || true)"
      export DATABASE_URL
    fi
  fi
  : "${DATABASE_URL:?DATABASE_URL required for --local (set env or install neonctl)}"
  : "${BASE_RPC_URL:?BASE_RPC_URL required for --local}"

  for i in $(seq 1 "$MAX_RUNS"); do
    echo "==> local indexer run $i / $MAX_RUNS"
    OUT=$(npm run indexer:owners -- "$MAX_BLOCKS" 2>&1) || {
      echo "$OUT"
      echo "Indexer failed on run $i" >&2
      exit 1
    }
    echo "$OUT" | tail -6
    echo "$OUT" | grep -q "caught up:         true" && {
      echo "==> caught up"
      exit 0
    }
    sleep "$SLEEP_SEC"
  done
  echo "==> reached MAX_RUNS ($MAX_RUNS) without catching up" >&2
  exit 2
}

run_cron() {
  : "${CRON_SECRET:?CRON_SECRET required}"

  for i in $(seq 1 "$MAX_RUNS"); do
    echo "==> cron index-owners run $i / $MAX_RUNS (maxBlocks=$MAX_BLOCKS)"
    RES=$(curl -s -m 280 -H "Authorization: Bearer $CRON_SECRET" \
      "$PROD_URL/api/cron/index-owners?maxBlocks=$MAX_BLOCKS") || {
      echo "curl failed on run $i" >&2
      exit 1
    }
    echo "$RES"
    if echo "$RES" | grep -q '"error":"forbidden"'; then
      echo "CRON_SECRET rejected (403). Update Vercel CRON_SECRET and retry." >&2
      exit 1
    fi
    echo "$RES" | grep -q '"caughtUp":true' && {
      echo "==> caught up"
      exit 0
    }
    sleep "$SLEEP_SEC"
  done
  echo "==> reached MAX_RUNS ($MAX_RUNS) without catching up" >&2
  exit 2
}

case "$MODE" in
  --local) run_local ;;
  cron|*) run_cron ;;
esac
