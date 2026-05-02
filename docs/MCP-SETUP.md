# Vibe Dash MCP Setup Guide

> **Source of truth** for MCP integration — transports, tool reference, and troubleshooting. README.md links here for setup details.

## Prerequisites

Vibe Dash must be running for the dashboard UI and WebSocket to work. The MCP stdio transport does NOT require the server to be running (it connects directly to SQLite), but you won't see real-time updates in the browser without the server.

## Step 1: Start Vibe Dash

From the vibe-dash directory:

```bash
# Development (hot-reload on both frontend and backend)
cd /path/to/vibe-dash
npm run dev
# Frontend: http://localhost:3000 (proxies API to :3001)
# Backend:  http://localhost:3001

# Production (single server, serves built frontend)
npm start
# Everything at http://localhost:3001
```

Leave this running in a terminal.

---

## Step 2: Configure Claude Code to use the MCP server

Three transports are available. Choose based on your setup:

| Transport | When to use |
|-----------|------------|
| **Stdio** | Single machine, offline-first. Each agent writes directly to SQLite. |
| **Streamable HTTP** | Multi-agent or remote. Modern MCP clients. Requires server running. |
| **SSE (legacy)** | Older MCP clients that don't support Streamable HTTP. |

### Option A: Stdio (recommended for local use)

Stdio spawns the MCP server as a child process. Each Claude Code session gets its own instance that writes directly to the shared SQLite database. This is the simplest setup and works offline.

Add to your **project-level** `.mcp.json` in each project that should report to Vibe Dash:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "command": "npx",
      "args": ["tsx", "/path/to/vibe-dash/server/mcp/stdio.ts"]
    }
  }
}
```

Or add it **globally** (all projects get it) in `~/.claude/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "command": "npx",
      "args": ["tsx", "/path/to/vibe-dash/server/mcp/stdio.ts"]
    }
  }
}
```

The stdio transport defaults to `<vibe-dash-dir>/vibe-dash.db` (same database the server reads). Override with the `VIBE_DASH_DB` environment variable if needed.

### Option B: Streamable HTTP (recommended for multi-agent/remote)

Streamable HTTP is the modern MCP transport. All communication goes through the running Vibe Dash server at `/mcp`. Supported by Claude Code, Cursor, Copilot (VS Code), and other up-to-date clients.

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Requires the Vibe Dash server to be running. The server logs `MCP (Streamable HTTP) at http://localhost:3001/mcp` on startup to confirm the endpoint is live.

### Option C: SSE (legacy)

SSE is the older HTTP transport. Use it only if your MCP client does not support Streamable HTTP.

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/sse"
    }
  }
}
```

Requires the Vibe Dash server to be running.

### Option C: Streamable HTTP

The server also exposes the newer Streamable HTTP transport at `/mcp` for clients that support it.

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Requires the Vibe Dash server to be running.

---

## Step 3: Load existing tasks from a project

Once Claude Code has the MCP server configured, start a Claude Code session in the project and ask it to load tasks into Vibe Dash. Here's a step-by-step prompt you can use:

### One-time bulk import prompt

Paste this into Claude Code in any project directory:

```
Using the vibe-dash MCP tools, do the following:

1. Call `list_projects` to check if this project already exists in Vibe Dash.
2. If not, call `create_project` with:
   - name: "<your-project-name>"
   - description: "<one-line description>"
3. Read the project's plan file (look in docs/superpowers/plans/ or wherever tasks are tracked) and STATUS.md if it exists.
4. For each task in the plan, call `create_task` with:
   - project_id: the ID returned in step 2
   - title: the task title
   - description: a brief summary
   - status: "done" if completed, "in_progress" if active, "planned" if not started
   - priority: "high", "medium", or "low" based on context
5. Log what you did by calling `log_activity` with a summary message.
```

---

## Step 4: Ongoing task reporting

Once the MCP server is configured, Claude Code can call Vibe Dash tools at any time. To make it automatic, add instructions to your project's CLAUDE.md:

### Add to each project's CLAUDE.md

```markdown
## Vibe Dash Integration

This project reports task status to Vibe Dash via MCP. When working on tasks:

1. **Starting a task**: Call `update_task` to set status to "in_progress"
2. **During work**: Call `log_activity` periodically with a brief status message (what you just did, what you're doing next). Include your agent name.
3. **Completing a task**: Call `complete_task` when done
4. **Blocked**: Call `report_blocker` with the reason. Call `resolve_blocker` when unblocked.
5. **New work discovered**: Call `create_task` for unplanned tasks that come up

### Available MCP tools

| Tool | Purpose |
|------|---------|
| `list_projects` | List all projects |
| `create_project` | Register a new project |
| `create_task` | Create a task (planned, in_progress, blocked, done) |
| `get_task` | Get task details by ID |
| `list_tasks` | List tasks with optional filters (project_id, status) |
| `update_task` | Update title, description, status, priority, progress |
| `complete_task` | Mark task done (sets status=done, progress=100) |
| `log_activity` | Log a status update (agent_name auto-registers) |
| `report_blocker` | Flag a task as blocked with reason |
| `resolve_blocker` | Clear a blocker |
| `register_agent` | Register/update an agent identity |
```

### Minimal version (add to CLAUDE.md)

If you want something shorter:

```markdown
## Vibe Dash

Report task progress to Vibe Dash via MCP tools. Call `log_activity` with status updates during work. Call `update_task` when task status changes. Call `complete_task` when done. Call `report_blocker` if stuck.
```

---

## Step 5: Verify it works

1. Open Vibe Dash in a browser (http://localhost:3000 for dev, http://localhost:3001 for production)
2. Start a Claude Code session in a project with the MCP config
3. Ask Claude to: `Call the vibe-dash list_projects tool`
4. You should see the response in Claude and the dashboard should show the data

### Quick smoke test from any project

```
Use the vibe-dash MCP tools to:
1. Create a project called "test-project"
2. Create a task "Test task" in that project with status "in_progress"
3. Log activity "Testing Vibe Dash integration"
4. Complete the task
```

Watch the dashboard — you should see each action appear in real time.

---

## Troubleshooting

**"Tool not found" or MCP not connecting:**
- Restart Claude Code after adding `.mcp.json`
- Check that `npx tsx` works: `npx tsx --version`
- Check the path to stdio.ts is correct and absolute

**Tasks not showing in dashboard:**
- Stdio transport writes directly to SQLite — the dashboard reads the same DB
- Refresh the browser if WebSocket disconnected
- Check the server is running (`npm run dev` or `npm start`)

**Database location:**
- Default: `<vibe-dash-dir>/vibe-dash.db`
- Override: set `VIBE_DASH_DB` environment variable (for stdio) or `DB_PATH` (for server)
- Both the stdio MCP and the server must use the same database file

**SSE connection refused:**
- Make sure the Vibe Dash server is running before starting Claude Code
- Check port 3001 is not blocked
