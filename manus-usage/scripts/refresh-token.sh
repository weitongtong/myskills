#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$SCRIPT_DIR/../.token"

print_json() {
  printf '%s\n' "$1"
}

if [[ -z "${1:-}" ]]; then
  print_json '{"ok":false,"error":"token_invalid","message":"缺少 token 参数，请提供 Manus JWT token"}'
  exit 1
fi

TOKEN="$1"

if ! node -e '
const token = process.argv[1];
if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) process.exit(1);
try {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (!payload || typeof payload !== "object") process.exit(1);
} catch {
  process.exit(1);
}
' "$TOKEN"; then
  print_json '{"ok":false,"error":"token_invalid","message":"Token 格式无效，请重新提取 Manus token"}'
  exit 1
fi

echo -n "$TOKEN" > "$TOKEN_FILE"
print_json '{"ok":true,"message":"Token 已保存"}'
