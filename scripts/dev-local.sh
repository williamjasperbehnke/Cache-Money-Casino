#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
API_PORT="${API_PORT:-8081}"
WEB_PORT="${WEB_PORT:-8080}"
TABLE_NAME="${TABLE_NAME:-casino_users}"
JWT_SECRET="${JWT_SECRET:-devsecret}"
LAN_IP="${LAN_IP:-}"

if [[ -z "$LAN_IP" ]]; then
  if command -v ipconfig >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
  fi
fi
if [[ -z "$LAN_IP" ]]; then
  LAN_IP="127.0.0.1"
fi

echo "Starting DynamoDB Local..."
if ! docker ps --format '{{.Names}}' | grep -q '^casino-dynamodb$'; then
  docker run -d --rm --name casino-dynamodb -p 8000:8000 amazon/dynamodb-local >/dev/null
else
  echo "DynamoDB Local already running."
fi

echo "Ensuring DynamoDB table exists..."
aws dynamodb describe-table \
  --table-name "$TABLE_NAME" \
  --endpoint-url http://localhost:8000 >/dev/null 2>&1 || \
aws dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=username,AttributeType=S \
  --key-schema AttributeName=username,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --endpoint-url http://localhost:8000 >/dev/null

echo "Configuring API base URL..."
cat >"$FRONTEND_DIR/js/config.js" <<EOF
window.API_BASE = "http://${LAN_IP}:${API_PORT}";
EOF

echo "Backend removed. Use the serverless API in AWS."
API_PID=""

echo "Starting static site on port ${WEB_PORT}..."
cd "$FRONTEND_DIR"
python3 -m http.server "${WEB_PORT}" --bind 0.0.0.0 &
WEB_PID=$!

echo "Local dev running."
echo "API:  http://${LAN_IP}:${API_PORT}"
echo "Site: http://${LAN_IP}:${WEB_PORT}"
echo "Press Ctrl+C to stop."

trap 'kill $WEB_PID' INT TERM
wait $WEB_PID
