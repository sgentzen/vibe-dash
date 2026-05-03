# Vibe Dash + OpenAI Codex

Connect the OpenAI Codex CLI agent to Vibe Dash so task progress, activity, and cost appear on your dashboard.

Requires **Codex CLI** with MCP support enabled. Run `codex --help | grep mcp` to confirm your version supports it.

---

## Step 1 — Start Vibe Dash

```bash
cd /path/to/vibe-dash && npm start
# Dashboard: http://localhost:3001
```

---

## Step 2 — Add the MCP server

**Option A: `~/.codex/config.toml`** (global, all Codex sessions)

```toml
[[mcp_servers]]
name    = "vibe-dash"
command = "npx"
args    = ["tsx", "/absolute/path/to/vibe-dash/server/mcp/stdio.ts"]
```

**Option B: Per-run `--mcp-server` flag**

```bash
codex --mcp-server '{"name":"vibe-dash","command":"npx","args":["tsx","/absolute/path/to/vibe-dash/server/mcp/stdio.ts"]}' \
  "your prompt here"
```

**Option C: Remote server** (Streamable HTTP, requires Vibe Dash server running)

```toml
[[mcp_servers]]
name = "vibe-dash"
url  = "http://localhost:3001/mcp"
```

---

## Step 3 — Add reporting instructions to `~/.codex/instructions.md`

Codex reads `~/.codex/instructions.md` globally, or `AGENTS.md` at the project root. Add to whichever applies:

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

```bash
codex "Use the vibe-dash MCP tools to list projects and log a test activity message."
```

Open `http://localhost:3001` — the activity should appear in the feed.

---

## Troubleshooting

- **MCP tools not available** — confirm Codex CLI version supports MCP (`codex --version`); update if needed
- **stdio path issues** — use an absolute path; `~/` is not always expanded by the CLI
- **Config not loaded** — Codex reads `~/.codex/config.toml`; check the path and TOML syntax
