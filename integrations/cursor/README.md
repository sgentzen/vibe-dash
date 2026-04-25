# Cursor → Vibe Dash Integration

Forward Cursor agent events to Vibe Dash for activity and cost tracking.

## Setup

1. Create an ingestion source in Vibe Dash (Settings → Ingestion → Add Source, kind: Cursor).
2. Copy the one-time bearer token.
3. Add to your Cursor user settings (`~/.cursor/settings.json` or workspace settings):

```json
{
  "cursor.agent.webhookUrl": "http://localhost:3001/api/ingest/cursor",
  "cursor.agent.webhookToken": "<your-token>"
}
```

> **Note:** Cursor's webhook agent API is in preview. Check Cursor's changelog for the current config key names.

## Payload shape

Cursor sends JSON objects. Vibe Dash normalizes these fields:

| Field | Description |
|---|---|
| `type` | `session_start`, `session_end`, `tool_call`, `file_edit` |
| `agent_id` | Used as the agent name in Vibe Dash |
| `model` | LLM model name |
| `cost` | Session cost in USD |
| `input_tokens` / `output_tokens` | Token counts |
