#!/usr/bin/env bash
# Lightweight local uptime probe for Vouch (agent-trust) production.
# Replaces the old "Agent trust uptime monitor" Claude-session routine —
# a plain curl loop doesn't need an LLM agent spun up per check.
# Runs via launchd (com.kizuna.vouch-uptime-monitor), logs always, and
# leaves a FAIL marker on failure for the daily improvement loop to notice.
set -uo pipefail

cd "$(dirname "$0")/.."
export CRON_SECRET
CRON_SECRET=$(grep -m1 '^CRON_SECRET=' .env.production.local | cut -d= -f2-)

LOG="logs/uptime-cron.log"
FAIL_MARKER="logs/uptime-cron.FAIL"
ts="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S %Z')"

if ./scripts/smoke-production.sh >>"$LOG" 2>&1; then
  echo "[$ts] OK" >>"$LOG"
  rm -f "$FAIL_MARKER"
else
  echo "[$ts] FAIL (see $LOG)" >>"$LOG"
  echo "$ts" >"$FAIL_MARKER"
fi
