# Vibe Dash + Cursor

Connect Cursor's agent to Vibe Dash so task progress, activity, and cost appear on your dashboard in real time.

Requires **Cursor 0.43+** (MCP support was added in 0.43).

---

## Step 1 — Start Vibe Dash

```bash
cd /path/to/vibe-dash && npm start
# Dashboard: http://localhost:3001
```

---

## Step 2 — Add the MCP server

**Option A: Cursor Settings UI** (recommended)

1. Open Cursor → **Settings** → **Cursor Settings** → **MCP**
2. Click **+ Add new MCP server**
3. Fill in:
   - **Name**: `vibe-dash`
   - **Type**: `command`
   - **Command**: `npx tsx /absolute/path/to/vibe-dash/server/mcp/stdio.ts`
4. Click **Save**

**Option B: Edit `~/.cursor/mcp.json` directly**

> Note: Cursor uses the key `"mcpServers"` — VS Code uses `"servers"`. They are different formats; don't mix them up.

```json
{
  "mcpServers": {
    "vibe-dash": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/vibe-dash/server/mcp/stdio.ts"]
    }
  }
}
```

**Option C: Remote server** (Streamable HTTP)

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Restart Cursor (or reload the MCP config via Settings → MCP → Refresh) after editing.

---

## Step 3 — Add reporting instructions to your project rules

In Cursor, open **Settings** → **Rules for AI** (or add a `.cursorrules` file at the project root):

```
## Vibe Dash

Report task progress to Vibe Dash via MCP tools:
- Before starting work: call list_tasks and update_task (status: in_progress)
- During work: call log_activity at checkpoints
- When blocked: call report_blocker
- When done: call complete_task, then log_cost with token counts and cost_usd
```

---

## Verify

Open `http://localhost:3001`, then ask Cursor's agent:

```
Use the vibe-dash MCP tools to list projects and log a test activity message.
```

The activity should appear in the feed within a second.

---

## Troubleshooting

- **Server not showing** — check Cursor Settings → MCP; the server should appear with a green dot
- **"Unknown tool"** — Cursor caches the tool list; reload via Settings → MCP → Refresh
- **stdio path issues** — use an absolute path; `~/` is not always expanded
