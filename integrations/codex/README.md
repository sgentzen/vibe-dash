# OpenAI Codex CLI → Vibe Dash Integration

Pipe Codex JSON output to Vibe Dash via a wrapper script.

## Setup

1. Create an ingestion source in Vibe Dash (Settings → Ingestion → Add Source, kind: Codex).
2. Copy the one-time bearer token.
3. Use the wrapper script instead of calling `codex` directly:

```bash
# Set once in your shell profile:
export VIBE_DASH_TOKEN=<your-token>
export VIBE_DASH_URL=http://localhost:3001

# Then run Codex through the wrapper:
./integrations/codex/codex-wrapper.sh "your prompt here"
```

## Wrapper script

The `codex-wrapper.sh` script runs `codex --json` and pipes each JSON line to Vibe Dash:

```bash
#!/usr/bin/env bash
set -euo pipefail
VIBE_URL="${VIBE_DASH_URL:-http://localhost:3001}"
TOKEN="${VIBE_DASH_TOKEN:?Set VIBE_DASH_TOKEN}"

codex --json "$@" | while IFS= read -r line; do
  echo "$line"
  curl -s -X POST "$VIBE_URL/api/ingest/codex" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$line" > /dev/null 2>&1 || true
done
```

## Payload shape

Codex emits one JSON object per line. Vibe Dash reads:

| Field | Description |
|---|---|
| `role` | `user`, `assistant`, `system` |
| `content` / `text` | Message content (used as activity message) |
| `usage.input_tokens` | Token count |
| `usage.output_tokens` | Token count |
| `model` | Model name |
| `cost` | Cost in USD |
