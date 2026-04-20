#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$SCRIPT_DIR/../.token"

print_json() {
  printf '%s\n' "$1"
}

json_error() {
  node - "$1" "$2" "${3:-}" <<'NODE'
const [code, message, details] = process.argv.slice(2);
const payload = { ok: false, error: code, message };
if (details) payload.details = JSON.parse(details);
console.log(JSON.stringify(payload));
NODE
}

die_json() {
  local code="$1"
  local message="$2"
  local exit_code="${3:-1}"
  local details="${4:-}"

  print_json "$(json_error "$code" "$message" "$details")"
  exit "$exit_code"
}

if [[ ! -f "$TOKEN_FILE" ]]; then
  die_json "token_not_found" "Token 文件不存在，请先刷新 token" 1
fi

MANUS_TOKEN="$(cat "$TOKEN_FILE")"

if [[ -z "$MANUS_TOKEN" ]]; then
  die_json "token_not_found" "Token 文件为空，请先刷新 token" 1
fi

if ! node -e '
const token = process.argv[1];
if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) process.exit(1);
try {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (!payload || typeof payload !== "object") process.exit(1);
} catch {
  process.exit(1);
}
' "$MANUS_TOKEN"; then
  die_json "token_invalid" "Token 格式无效，请重新提取 Manus token" 1
fi

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
    die_json "token_expired" "Manus token 已过期，请刷新 token" 2
  fi

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    local details
    details="$(node - "$http_code" "$response" <<'NODE'
const [httpCode, body] = process.argv.slice(2);
console.log(JSON.stringify({ httpCode: Number(httpCode), body }));
NODE
)"
    die_json "api_error" "Manus API 请求失败" 3 "$details"
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
    printf '{"ok":true,"credits":%s,"usageLog":%s}\n' "$CREDITS" "$LOG"
    ;;
  *)
    die_json "api_error" "用法错误：fetch-usage.sh [credits|log|all] [page] [pageSize]" 1
    ;;
esac
