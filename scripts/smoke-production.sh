#!/usr/bin/env bash
# Free ops smoke checks for Hobby deploy (no paid uptime SaaS required).
# Usage:
#   ./scripts/smoke-production.sh
#   CRON_SECRET=... ./scripts/smoke-production.sh   # also hits monitor-health
#
# 2026-08-23 監査で発覚した壊れ方（実測）:
#   既定URLが旧ドメイン agent-trust-tawny.vercel.app のままで、8/13 に 308 転送が
#   入って以降ずっと転送を測っていた。`-L` が無いため /api/health は 308 の空ボディ
#   （"Redirecting..."）を受け取るが、`curl -fsS` は 3xx をエラーにしないので
#   **素通りで合格**していた。落ちていたのは後続の docs/api（308≠200）だけ。
#   ログ実測: FAIL 938行・最初のFAIL 2026-07-28 04:56・最後のOK 2026-08-13 19:22。
#   つまり本番の生死を1ヶ月近く測れていなかった。
#
# 直し方の原則: 転送を「たまたま追う」のではなく、**転送されたこと自体を失敗にする**。
#   計器が別のものを測り始めたら、静かに合格せず鳴る。
set -euo pipefail

PROD_URL="${PROD_URL:-https://vet402.com}"
EXPECTED_HOST="${EXPECTED_HOST:-$(printf '%s' "$PROD_URL" | sed -E 's#^https?://##; s#/.*$##')}"

fail() { echo "FAIL: $*" >&2; exit 1; }

# 転送先が期待ホストから動いていないことを先に確かめる。`-L` で追った上で、
# 最終URLのホストが EXPECTED_HOST と一致しなければ失敗（ドメイン移転や
# プレビューURLへの誤配線を、合格に化けさせない）。
assert_no_domain_drift() {
  local path="$1" final
  final=$(curl -sSL -o /dev/null -w '%{url_effective}' "$PROD_URL$path")
  local host
  host=$(printf '%s' "$final" | sed -E 's#^https?://##; s#/.*$##')
  if [[ "$host" != "$EXPECTED_HOST" ]]; then
    fail "domain drift on $path: expected host $EXPECTED_HOST, landed on $host ($final).
      監視が別のドメインを測り始めている。PROD_URL/EXPECTED_HOST を実態に合わせるか、転送を直すこと。"
  fi
}

echo "==> base URL: $PROD_URL (expected host: $EXPECTED_HOST)"
assert_no_domain_drift "/api/health"

echo "==> health"
health_code=$(curl -sSL -o /tmp/vouch-health.json -w '%{http_code}' "$PROD_URL/api/health")
[[ "$health_code" == "200" ]] || fail "health http $health_code (body: $(head -c 200 /tmp/vouch-health.json))"
# 中身がJSONであることまで見る。308の "Redirecting..." を合格にしていたのが今回の欠陥。
python3 -c 'import json,sys; json.load(open("/tmp/vouch-health.json"))' 2>/dev/null \
  || fail "health returned non-JSON (body: $(head -c 200 /tmp/vouch-health.json))"
cat /tmp/vouch-health.json
echo
echo "ok ($health_code)"

echo "==> docs/api"
assert_no_domain_drift "/docs/api"
code=$(curl -sSL -o /dev/null -w "%{http_code}" "$PROD_URL/docs/api")
[[ "$code" == "200" ]] || fail "docs/api http $code"
echo "ok ($code)"

if [[ -n "${CRON_SECRET:-}" ]]; then
  echo "==> monitor-health"
  code=$(curl -sSL -o /tmp/vouch-monitor.json -w "%{http_code}" \
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
      fail "monitor-health rejected CRON_SECRET (http $code) — deep health checks are NOT running"
      ;;
    *)
      fail "unexpected monitor-health status: $code"
      ;;
  esac
else
  echo "==> monitor-health skipped (set CRON_SECRET to probe)"
fi

echo "smoke ok"
