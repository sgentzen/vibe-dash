# Vibe Dash + Aider

**Maturity: Preview** — Aider's MCP support is recent (~0.67) and still stabilizing.

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

**Option A: Streamable HTTP (recommended)**: requires the Vibe Dash server running, in `~/.aider.conf.yml` (global) or `aider.conf.yml` at the project root:

```yaml
mcp_servers:
  - name: vibe-dash
    url: http://localhost:3001/mcp
```

**Option B: Stdio (fallback, one session at a time)**: only when you cannot run the server. Running more than one stdio process at once, or stdio alongside a running server, has corrupted this project's database before; see the transport comparison and corruption warning in [docs/MCP-SETUP.md](../MCP-SETUP.md#step-2-configure-claude-code-to-use-the-mcp-server). Works the same in `~/.aider.conf.yml` or `aider.conf.yml`:

```yaml
mcp_servers:
  - name: vibe-dash
    command: npx
    args:
      - tsx
      - /absolute/path/to/vibe-dash/server/mcp/stdio.ts
```

**Option C: Command-line flag** (per-session, either transport)

```bash
aider --mcp-server '{"name":"vibe-dash","url":"http://localhost:3001/mcp"}'
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
- **stdio path issues** (Option B): use an absolute path; `~/` is not always expanded
