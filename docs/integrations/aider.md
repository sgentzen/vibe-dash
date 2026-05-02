# Vibe Dash + Aider

Connect Aider to Vibe Dash so task progress and activity appear on your dashboard.

Requires **Aider 0.67+** (MCP support was introduced around 0.67; check `aider --help | grep mcp` to confirm your version supports it).

---

## Step 1 — Start Vibe Dash

```bash
cd /path/to/vibe-dash && npm start
# Dashboard: http://localhost:3001
```

---

## Step 2 — Add the MCP server

**Option A: `~/.aider.conf.yml`** (global)

```yaml
mcp_servers:
  - name: vibe-dash
    command: npx
    args:
      - tsx
      - /absolute/path/to/vibe-dash/server/mcp/stdio.ts
```

**Option B: `aider.conf.yml`** at the project root (project-level)

```yaml
mcp_servers:
  - name: vibe-dash
    command: npx
    args:
      - tsx
      - /absolute/path/to/vibe-dash/server/mcp/stdio.ts
```

**Option C: Remote server** (Streamable HTTP, requires Vibe Dash server running)

```yaml
mcp_servers:
  - name: vibe-dash
    url: http://localhost:3001/mcp
```

**Option D: Command-line flag** (per-session)

```bash
aider --mcp-server '{"name":"vibe-dash","command":"npx","args":["tsx","/absolute/path/to/vibe-dash/server/mcp/stdio.ts"]}'
```

---

## Step 3 — Add reporting instructions to `.aider.system.md`

Create `.aider.system.md` at your project root (Aider prepends it to every system prompt):

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

Start Aider and ask:

```
Use the vibe-dash MCP tools to list projects and log a test activity message.
```

Open `http://localhost:3001` — the activity should appear in the feed.

---

## Troubleshooting

- **"No MCP tools available"** — confirm Aider version (`aider --version`); upgrade if below 0.67
- **Config not loaded** — Aider reads `.aider.conf.yml` from the working directory, then `~/.aider.conf.yml`
- **stdio path issues** — use an absolute path; `~/` is not always expanded
