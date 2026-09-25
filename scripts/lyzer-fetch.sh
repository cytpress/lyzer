#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3020}"
FETCH_PAGES="${FETCH_PAGES:-3}"
: "${LYZER_JOB_TOKEN:?LYZER_JOB_TOKEN is required}"

echo "[$(date -Is)] Fetch latest gazettes"

curl --fail --show-error --silent \
  -X POST "$API_BASE/jobs/fetch" \
  -H "Authorization: Bearer $LYZER_JOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"pages\":${FETCH_PAGES}}"

echo
echo "[$(date -Is)] Fetch done"
