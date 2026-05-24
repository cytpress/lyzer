#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3020}"
FETCH_PAGES="${FETCH_PAGES:-3}"

echo "[$(date -Is)] Fetch latest gazettes"

curl --fail --show-error --silent \
  -X POST "$API_BASE/jobs/fetch" \
  -H "Content-Type: application/json" \
  -d "{\"pages\":${FETCH_PAGES}}"

echo
echo "[$(date -Is)] Fetch done"
