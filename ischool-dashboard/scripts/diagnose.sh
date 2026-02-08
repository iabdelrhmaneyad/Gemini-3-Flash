#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-}}"

if [[ -z "${BASE_URL}" ]]; then
  echo "Usage: $0 https://your-domain" >&2
  echo "   or: BASE_URL=https://your-domain $0" >&2
  exit 1
fi

echo "=== API Health (${BASE_URL}) ==="
code=$(curl -s -o /dev/null -w "HTTP %{http_code}\n" "${BASE_URL}/api/queue/status" || true)
echo "${code}"

echo -e "\n=== Socket.IO Handshake ==="
curl -s "${BASE_URL}/socket.io/?EIO=4&transport=polling" | head -c 200 || true
echo

echo -e "\n=== Local Process (pm2) ==="
if command -v pm2 >/dev/null 2>&1; then
  pm2 status || true
else
  echo "pm2 not installed"
fi

echo -e "\n=== Disk Space ==="
df -h / | tail -1 || true

echo -e "\n=== Session Folders Count (../Sessions) ==="
if [[ -d "../Sessions" ]]; then
  ls -1 ../Sessions 2>/dev/null | wc -l | awk '{print $1 " tutor folders found"}'
else
  echo "../Sessions not found"
fi
