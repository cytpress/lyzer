#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3020}"

echo "[$(date -Is)] Check whether Cloudflare deploy is needed"

curl --fail --show-error --silent \
  -X POST "$API_BASE/jobs/deploy-check" \
  -H "Content-Type: application/json" \
  -d '{}'

echo
echo "[$(date -Is)] Deploy check done"
