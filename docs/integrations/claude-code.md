# Vibe Dash + Claude Code

Connect Claude Code to Vibe Dash so every session reports task progress, activity, and cost to your dashboard.

---

## Step 1 — Start Vibe Dash

```bash
cd /path/to/vibe-dash && npm start
# Dashboard: http://localhost:3001
```

---

## Step 2 — Add the MCP server

**Project-level** (one project reports to Vibe Dash) — add `.mcp.json` at your project root:

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

**Global** (all projects report to Vibe Dash) — add to `~/.claude/settings.json`:

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

**Remote server** (Streamable HTTP — useful for shared/team dashboards):

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Restart Claude Code after editing. Claude Code discovers MCP servers at session start.

---

## Step 3 — Add reporting instructions to CLAUDE.md

Paste into your project's `CLAUDE.md` (or the global `~/.claude/CLAUDE.md`):

```markdown
## Vibe Dash

This project reports task status to Vibe Dash via MCP. When working on tasks:

1. Before starting: call `list_tasks` to check the priority stack
2. Claim work: call `update_task` to set status to `in_progress`
3. During work: call `log_activity` at natural checkpoints
4. Report blockers: call `report_blocker` with a specific reason
5. When done: call `complete_task`
6. Log cost: call `log_cost` with model name, token counts, and cost_usd
```

---

## Verify

Open the dashboard at `http://localhost:3001`, then ask Claude to:

```
Use the vibe-dash MCP tools to list projects and log a test activity.
```

You should see the activity appear in the feed within a second.

---

## Troubleshooting

- **"Tool not found"** — restart Claude Code; it loads MCP servers at startup
- **Tasks not appearing** — stdio writes directly to SQLite; refresh the browser if the WebSocket disconnected
- **Path issues** — use the absolute path to `stdio.ts`; `~/` expansion is not supported in all contexts
