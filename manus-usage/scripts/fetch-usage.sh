#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$SCRIPT_DIR/../.token"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo '{"error":"token_not_found","message":"Token 文件不存在，请先刷新 token"}' >&2
  exit 1
fi

MANUS_TOKEN="$(cat "$TOKEN_FILE")"

call_api() {
  local endpoint="$1"
  local body="${2:-"{}"}"
  local tmp_file
  tmp_file=$(mktemp)
  trap "rm -f '$tmp_file'" RETURN

  local http_code
  http_code=$(curl -s -o "$tmp_file" -w "%{http_code}" -X POST \
    "https://api.manus.im/user.v1.UserService/${endpoint}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MANUS_TOKEN" \
    -H "connect-protocol-version: 1" \
    -d "$body")

  local response
  response=$(cat "$tmp_file")

  if [[ "$http_code" == "401" ]] || echo "$response" | grep -q '"unauthenticated"'; then
    echo '{"error":"token_expired","message":"Manus token 已过期，请按 SKILL.md 中的指引刷新 token"}' >&2
    exit 2
  fi

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    printf '{"error":"api_error","http_code":%s,"body":%s}\n' "$http_code" "$response" >&2
    exit 3
  fi

  echo "$response"
}

ACTION="${1:-all}"

case "$ACTION" in
  credits)
    call_api "GetAvailableCredits" "{}"
    ;;
  log)
    PAGE="${2:-1}"
    SIZE="${3:-20}"
    call_api "ListUserCreditsLog" "{\"page\":$PAGE,\"pageSize\":$SIZE}"
    ;;
  all)
    CREDITS=$(call_api "GetAvailableCredits" "{}")
    LOG=$(call_api "ListUserCreditsLog" '{"page":1,"pageSize":20}')
    printf '{"credits":%s,"usageLog":%s}\n' "$CREDITS" "$LOG"
    ;;
  *)
    echo "Usage: $0 [credits|log|all] [page] [pageSize]" >&2
    exit 1
    ;;
esac
