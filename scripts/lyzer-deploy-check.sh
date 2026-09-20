#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3020}"
: "${LYZER_JOB_TOKEN:?LYZER_JOB_TOKEN is required}"

echo "[$(date -Is)] Check whether Cloudflare deploy is needed"

curl --fail --show-error --silent \
  -X POST "$API_BASE/jobs/deploy-check" \
  -H "Authorization: Bearer $LYZER_JOB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

echo
echo "[$(date -Is)] Deploy check done"
