# Aider → Vibe Dash Integration

Stream Aider's JSON output to Vibe Dash for cost and activity tracking.

## Setup

1. Create an ingestion source in Vibe Dash (Settings → Ingestion → Add Source, kind: Aider).
2. Copy the one-time bearer token.
3. Add the `.aider.conf.yml` snippet below (or pass flags directly).

## `.aider.conf.yml` snippet

```yaml
# Forward each JSON line to Vibe Dash
# Replace <your-token> with your ingestion source token
analytics: true
```

Then run Aider with the included wrapper:

```bash
export VIBE_DASH_TOKEN=<your-token>
./integrations/aider/aider-wrapper.sh --model gpt-4o "your request"
```

## Wrapper script

```bash
#!/usr/bin/env bash
VIBE_URL="${VIBE_DASH_URL:-http://localhost:3001}"
TOKEN="${VIBE_DASH_TOKEN:?Set VIBE_DASH_TOKEN}"

aider --json "$@" | while IFS= read -r line; do
  echo "$line"
  curl -s -X POST "$VIBE_URL/api/ingest/aider" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$line" > /dev/null 2>&1 || true
done
```

## Payload shape

Aider emits JSON lines when run with `--json`. Vibe Dash reads:

| Field | Description |
|---|---|
| `type` | `cost`, `file_change`, `edit` (or absent for activity) |
| `message` / `content` | Activity description |
| `cost` / `total_cost_usd` | Session cost |
| `tokens_sent` / `tokens_received` | Token counts |
| `model` | Model name |
| `file` | File path for edit events |
