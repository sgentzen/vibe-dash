# Vibe Dash + OpenAI Codex

**Maturity: Preview** — depends on your Codex CLI version's MCP support (still stabilizing).

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

## Step 4 (optional) — report cost over OTLP instead of `log_cost`

The `log_cost` line above asks Codex to report its own spend, which only
happens when the agent remembers to do it and cannot be checked afterwards.
Codex can instead export its token usage automatically over OpenTelemetry.
Add this to `~/.codex/config.toml`:

```toml
[otel]
metrics_exporter = "otlp-http"

[otel.exporter.otlp-http]
endpoint = "http://localhost:3001"
protocol = "json"
```

**If you do this, drop the `log_cost` step from Step 3, or your spend will be
counted twice.** OTLP rows and `log_cost` rows are stored separately and
neither suppresses the other, so a setup running both reports every turn
twice and the doubled total looks entirely plausible. If you have already
recorded doubled rows, call `POST /api/agents/:id/cost-observed` for the
agent, which corrects what is already stored as well as what comes later.

Two limits worth knowing before you rely on it. Only the interactive CLI
emits metrics, so `codex exec` and `codex mcp-server` report nothing. And
only `gpt-5.3-codex` currently has a price in the rate table, so another
model records its tokens with no cost figure rather than a zero.

[docs/ingestion.md](../ingestion.md) covers project attribution and the rest
of the limits in full.

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
