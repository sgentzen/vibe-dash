# GitHub Copilot Workspace → Vibe Dash Integration

Forward Copilot Workspace agent events to Vibe Dash.

## Setup

1. Create an ingestion source in Vibe Dash (Settings → Ingestion → Add Source, kind: Copilot Workspace).
2. Copy the one-time bearer token.
3. Configure the Copilot Workspace webhook (when available in GitHub settings):

```
Endpoint: http://your-vibe-dash-host:3001/api/ingest/copilot
Token:    <your-token> (sent as Authorization: Bearer header)
```

> **Note:** Copilot Workspace's external event webhook is currently in preview. Check GitHub docs for the current configuration path.

## Payload shape

| Field | Description |
|---|---|
| `action` | `session.start`, `session.end`, `edit`, `file_change` |
| `workspace_id` / `session_id` | Used as agent name |
| `file` / `path` | File path for edit events |
| `message` | Activity description |
| `cost` | Session cost estimate |
