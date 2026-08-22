#!/usr/bin/env bash
# Lightweight local uptime probe for Vouch (vet402) production.
# Runs via launchd (com.kizuna.vouch-uptime-monitor), logs always, and
# leaves a FAIL marker on failure.
#
# 2026-08-23 監査: FAIL マーカーの読み手は daily-improvement-loop だけだったが、
# そのタスクは無効化されている。**鳴っても誰にも届いていなかった**（実測: 30分ごとに
# 失敗し続けて938行、誰も気づかないまま1ヶ月）。
# fail-loud の正典 state/ALERTS.md へ直接書く。連投を避けるため、状態が
# OK→FAIL に変わった最初の1回と、以後6時間ごとにだけ書く。
set -uo pipefail

cd "$(dirname "$0")/.."
export CRON_SECRET
CRON_SECRET=$(grep -m1 '^CRON_SECRET=' .env.production.local | cut -d= -f2-)

LOG="logs/uptime-cron.log"
FAIL_MARKER="logs/uptime-cron.FAIL"
ALERTS="${VET402_ALERTS_FILE:-$HOME/Takeshi_Automation/state/ALERTS.md}"
REALERT_SECONDS=21600   # 6h
ts="$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S %Z')"

note_alert() {
  local reason="$1"
  [[ -f "$ALERTS" ]] || return 0
  {
    printf '\n## [%s] vet402 本番監視が失敗 (uptime-cron)\n\n' "$ts"
    printf '%s\n\n' "$reason"
    printf 'ログ: `%s/%s`（末尾20行）\n\n```\n%s\n```\n' \
      "$(pwd)" "$LOG" "$(tail -20 "$LOG" 2>/dev/null)"
  } >>"$ALERTS"
}

if OUT=$(./scripts/smoke-production.sh 2>&1); then
  printf '%s\n[%s] OK\n' "$OUT" "$ts" >>"$LOG"
  if [[ -f "$FAIL_MARKER" ]]; then
    # 復旧も記録する（鳴りっぱなしと復旧を区別できるように）。
    [[ -f "$ALERTS" ]] && printf '\n## [%s] vet402 本番監視が復旧 (uptime-cron)\n\n直前の失敗は解消。\n' "$ts" >>"$ALERTS"
  fi
  rm -f "$FAIL_MARKER"
else
  printf '%s\n[%s] FAIL (see %s)\n' "$OUT" "$ts" "$LOG" >>"$LOG"
  now=$(date +%s)
  last=0
  [[ -f "$FAIL_MARKER" ]] && last=$(sed -n '2p' "$FAIL_MARKER" 2>/dev/null || echo 0)
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  if (( last == 0 || now - last >= REALERT_SECONDS )); then
    note_alert "$(printf '%s' "$OUT" | grep -m1 '^FAIL:' || echo 'smoke-production.sh が非ゼロ終了')"
    printf '%s\n%s\n' "$ts" "$now" >"$FAIL_MARKER"
  else
    # マーカーは維持したまま最終アラート時刻を保つ（連投しない）。
    printf '%s\n%s\n' "$ts" "$last" >"$FAIL_MARKER"
  fi
fi
