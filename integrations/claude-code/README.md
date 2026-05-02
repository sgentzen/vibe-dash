# Claude Code → Vibe Dash Integration

Automatically sends tool use events, costs, and session lifecycle to Vibe Dash via Claude Code hooks.

## Setup

1. Create an ingestion source in Vibe Dash (Settings → Ingestion → Add Source, kind: Claude Code).
2. Copy the one-time bearer token shown after creation.
3. Set `VIBE_DASH_TOKEN=<your-token>` in your shell environment (or `.env`).
4. Merge `hooks.json` into your project's `.claude/settings.json`:

```json
{
  "hooks": { ...contents of hooks.json "hooks" key... }
}
```

5. Optionally set `VIBE_DASH_URL` if your server runs on a different port:

```bash
export VIBE_DASH_URL=http://localhost:3001
```

## What gets ingested

| Hook | Vibe Dash event |
|---|---|
| `UserPromptSubmit` | `session_start` |
| `PreToolUse` | `tool_call` |
| `PostToolUse` (write tools) | `file_change` + optional cost |
| `PostToolUse` (other) | `tool_call` |
| `Stop` | `session_end` + cost rollup |

Costs appear in the Cost Intelligence view automatically.
