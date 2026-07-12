#!/usr/bin/env bash
# Create a proposal from sample-proposal.json.
# Usage: API_TOKEN=xxx APP_URL=https://your-worker.workers.dev ./create-proposal.sh
set -euo pipefail
curl -s -X POST "${APP_URL:-http://localhost:8787}/api/proposals" \
  -H "authorization: Bearer ${API_TOKEN:?set API_TOKEN}" \
  -H "content-type: application/json" \
  --data @"$(dirname "$0")/sample-proposal.json"
echo
