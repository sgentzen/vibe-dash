#!/usr/bin/env bash
# Wrapper for Aider that forwards JSON output to Vibe Dash.
# Usage: VIBE_DASH_TOKEN=<token> ./aider-wrapper.sh --model gpt-4o "your request"
set -euo pipefail

VIBE_URL="${VIBE_DASH_URL:-http://localhost:3001}"
TOKEN="${VIBE_DASH_TOKEN:?Set VIBE_DASH_TOKEN to your ingestion source token}"

aider --json "$@" | while IFS= read -r line; do
  echo "$line"
  curl -s -X POST "$VIBE_URL/api/ingest/aider" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$line" > /dev/null 2>&1 || true
done
