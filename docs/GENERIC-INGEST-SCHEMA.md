# Generic Ingest Schema

`POST /api/ingest/generic` accepts any JSON object. Fields recognized:

| Field | Type | Description |
|---|---|---|
| `kind` | `"activity"` \| `"cost"` \| `"tool_call"` \| `"file_change"` \| `"session_start"` \| `"session_end"` | Event type. Defaults to `"activity"`. |
| `agent_name` | string | Agent name. Auto-registered on first sighting. |
| `message` | string | Human-readable activity description. Required for `activity` events. |
| `task_id` | string | UUID of an existing task. Required to log activity against a task. |
| `project_id` | string | UUID of a project. Associates the event with a project (overrides the source's default project). |
| `model` | string | LLM model name (e.g. `"gpt-4o"`, `"claude-sonnet-4-6"`). Required for cost events. |
| `provider` | string | Provider name (e.g. `"openai"`, `"anthropic"`). |
| `input_tokens` | number | Input token count. |
| `output_tokens` | number | Output token count. |
| `cost_usd` | number | Session/request cost in USD. |
| `file_path` | string | File path (for `file_change` events). |
| `tool_name` | string | Tool name (for `tool_call` events). |
| `session_id` | string | Session identifier. |

## Notes

- All fields are optional. Unknown fields are ignored.
- The endpoint returns `202 Accepted` immediately; materialization is async.
- Cost events require at least `model` and one of `cost_usd`, `input_tokens`, or `output_tokens` to be recorded.
- Activity events require `task_id` to appear in the task's activity log.
- Agent is auto-registered by `agent_name` if not yet known to Vibe Dash.
