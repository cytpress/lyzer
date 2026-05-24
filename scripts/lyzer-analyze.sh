#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3020}"
ANALYZE_LIMIT="${ANALYZE_LIMIT:-1}"
LOCK_FILE="${LOCK_FILE:-/tmp/lyzer-analyze.lock}"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] Another analyze job is already running. Exit."
  exit 0
fi

echo "[$(date -Is)] Analyze pending agendas"

curl --fail --show-error --silent \
  -X POST "$API_BASE/jobs/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":${ANALYZE_LIMIT}}"

echo
echo "[$(date -Is)] Analyze done"
