# Vibe Dash + GitHub Copilot

Connect GitHub Copilot (VS Code) to Vibe Dash so task progress and activity appear on your dashboard.

Requires **VS Code 1.99+** and **GitHub Copilot Chat** with MCP support enabled.

---

## Step 1 — Start Vibe Dash

```bash
cd /path/to/vibe-dash && npm start
# Dashboard: http://localhost:3001
```

---

## Step 2 — Add the MCP server

**Option A: Workspace config** (project-level) — create `.vscode/mcp.json`:

```json
{
  "servers": {
    "vibe-dash": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/vibe-dash/server/mcp/stdio.ts"]
    }
  }
}
```

**Option B: User settings** (global) — add to `settings.json` (`Ctrl+Shift+P` → "Open User Settings (JSON)"):

```json
{
  "mcp": {
    "servers": {
      "vibe-dash": {
        "type": "stdio",
        "command": "npx",
        "args": ["tsx", "/absolute/path/to/vibe-dash/server/mcp/stdio.ts"]
      }
    }
  }
}
```

**Option C: Remote server** (Streamable HTTP)

```json
{
  "servers": {
    "vibe-dash": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Reload VS Code (or restart the MCP server from the Copilot panel) after editing.

---

## Step 3 — Enable agent mode and add instructions

1. In Copilot Chat, switch to **Agent** mode (the dropdown next to the chat input)
2. Add a `.github/copilot-instructions.md` to your repo:

```markdown
## Vibe Dash

Report task progress to Vibe Dash via MCP tools:
- Before starting: call list_tasks and update_task (status: in_progress)
- During work: call log_activity at checkpoints
- When blocked: call report_blocker
- When done: call complete_task, then log_cost with token counts and cost_usd
```

---

## Verify

In Copilot Chat (Agent mode):

```
Use the vibe-dash MCP tools to list projects and log a test activity message.
```

Open `http://localhost:3001` — the activity should appear in the feed.

---

## Troubleshooting

- **Tools not available** — MCP in Copilot requires agent mode; ensure the dropdown shows "Agent", not "Ask" or "Edit"
- **Server not found** — check VS Code Output → GitHub Copilot for MCP initialization errors
- **Copilot asks for approval** — VS Code prompts before calling MCP tools; approve once or configure auto-approval in settings
