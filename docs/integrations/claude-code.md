# Vibe Dash + Claude Code

**Maturity: Tested** — verified end-to-end (this is the reference integration).

Connect Claude Code to Vibe Dash so every session reports task progress and activity to your dashboard, and has its cost tracked automatically. Claude Code talks to Vibe Dash over MCP, giving Claude *tools* (`list_tasks`, `update_task`, `log_activity`, …) it uses to read and write task state as it works.

---

## Step 1 — Start Vibe Dash

```bash
cd /path/to/vibe-dash && npm start
# Dashboard: http://localhost:3001
```

---

## Step 2 — Add the MCP server

**Streamable HTTP (recommended)**: points at the running Vibe Dash server, keeps the dashboard live, and is the only transport safe for more than one session at a time. Add `.mcp.json` at your project root, or the same block to `~/.claude/settings.json` for all projects:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "type": "http",
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

**Stdio (fallback, one session at a time)**: only when you cannot run the server. Running more than one stdio process at once, or stdio alongside a running server, has corrupted this project's database before; see the transport comparison and corruption warning in [docs/MCP-SETUP.md](../MCP-SETUP.md#step-2-configure-claude-code-to-use-the-mcp-server).

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

The same block works project-level (`.mcp.json`) or globally (`~/.claude/settings.json`).

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
```

> **Cost is not something you need to report.** Vibe Dash reads Claude Code's
> own session transcripts off disk and records token spend automatically, so
> there is no `log_cost` step here. See
> [docs/ingestion.md](../ingestion.md) for exactly what is read.

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
- **Tasks not appearing**: on stdio this is expected, see [docs/MCP-SETUP.md](../MCP-SETUP.md); on Streamable HTTP, refresh the browser if the WebSocket disconnected
- **Path issues** — use the absolute path to `stdio.ts`; `~/` expansion is not supported in all contexts
