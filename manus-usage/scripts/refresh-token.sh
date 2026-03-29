#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$SCRIPT_DIR/../.token"

if [[ -z "${1:-}" ]]; then
  echo "Usage: $0 <jwt_token>" >&2
  echo "Extracts and saves the Manus JWT token." >&2
  exit 1
fi

echo -n "$1" > "$TOKEN_FILE"
echo "Token saved to $TOKEN_FILE"
