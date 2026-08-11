# Vibe Dash

**The open-source project layer for AI-driven development.**

Connect your AI coding agents — Claude Code, Cursor, Codex, Copilot, Aider — to a shared task board, activity feed, and cost tracker. One dashboard, all your agents, no accounts required.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

---

## What it does

When multiple AI agents work across multiple projects, you lose visibility into what's happening, what's blocked, and what it's costing you. Vibe Dash gives your agents a shared workspace:

- **Task board** — agents claim tasks, log progress, and flag blockers through MCP tool calls
- **Activity feed** — every agent action appears in real time; no polling needed
- **Cost tracker**: per-model token spend, read directly from Claude Code's local session transcripts, plus OTLP metrics for runners with a mapper (Codex today)
- **Local-first** — SQLite on your machine, no cloud, no subscriptions

> **How reporting works:** cost and token figures for Claude Code are read from
> its own transcripts on disk, so they are correct whether or not an agent
> remembered to report anything. A runner Vibe Dash has a mapper for can also
> send cost over OTLP with no agent cooperation at all — Codex today, see
> [docs/ingestion.md](docs/ingestion.md#cost-from-other-runners-over-otlp) for
> setup and its limits. Task status is different: that still arrives because an
> agent chose to call an MCP tool, so a task nobody updates stays stale. Any
> other agent, or Codex outside its mapped OTLP setup, reports cost through the
> `log_cost` tool. See [docs/ingestion.md](docs/ingestion.md) for exactly what
> is read and what is not.

---

## Quick Start

Requires **Node.js 20+**.

```bash
git clone https://github.com/sgentzen/vibe-dash.git
cd vibe-dash
npm install
npm start          # http://localhost:3001
```

For development with hot-reload:

```bash
npm run dev        # Frontend :3000, backend :3001
```

---

## Connect your agents (60-second guides)

Every agent connects the same way — over **MCP**. Pick your agent, follow its guide (each is a copy-paste `.mcp.json`/settings snippet plus a CLAUDE.md reporting block), and it starts reporting to the dashboard.

| Agent | Guide | Maturity |
|-------|-------|----------|
| Claude Code | [docs/integrations/claude-code.md](docs/integrations/claude-code.md) | ✅ Tested |
| Cursor | [docs/integrations/cursor.md](docs/integrations/cursor.md) | 🧪 Preview |
| OpenAI Codex | [docs/integrations/codex.md](docs/integrations/codex.md) | 🧪 Preview |
| GitHub Copilot | [docs/integrations/copilot.md](docs/integrations/copilot.md) | 🧪 Preview |
| Aider | [docs/integrations/aider.md](docs/integrations/aider.md) | 🧪 Preview |

> **Maturity:** ✅ **Tested** — verified end-to-end. 🧪 **Preview** — a standard MCP setup that should work, but the Vibe Dash integration hasn't been independently verified (and some clients' MCP support is still stabilizing).

Two MCP transports are available:

| Transport | URL / Command | Best for |
|-----------|--------------|---------|
| **Stdio** | `npx tsx /path/to/vibe-dash/server/mcp/stdio.ts` | Single-machine, offline-first |
| **Streamable HTTP** | `http://localhost:3001/mcp` | Multi-agent, remote, modern clients |

Full setup guide with task import, CLAUDE.md snippets, and troubleshooting: [docs/MCP-SETUP.md](docs/MCP-SETUP.md).

---

## Dashboard views

- **Fleet** — multi-project status overview; switch the *Agents* preset for the live per-agent roster with health, session, and cost breakdown
- **Board** — Kanban (Planned / In Progress / Done) with agent assignments, priority, tags, and progress bars
- **Feed** — real-time activity stream of every agent action across projects

---

## MCP tools

Core tools your agents will use most:

| Tool | Purpose |
|------|---------|
| `create_project` | Register a project |
| `list_tasks` / `search_tasks` / `get_task` | Find work |
| `create_task` / `update_task` / `complete_task` | Manage tasks |
| `create_milestone` / `complete_milestone` / `list_milestones` | Group work into milestones |
| `register_agent` / `heartbeat` | Announce an agent and keep it live |
| `log_activity` | Post a status update (auto-registers the agent) |
| `report_blocker` / `resolve_blocker` | Flag and clear blockers |
| `log_cost` | Record token spend. Claude Code cost is read from transcripts instead, so this is ignored for any MCP client marked cost-observed, covering every session of that client, past and future. See [docs/ingestion.md](docs/ingestion.md#upgrading-from-an-earlier-version) |
| `get_project_context` | Pull a project's current state in one call |

See [docs/MCP-SETUP.md](docs/MCP-SETUP.md) for the full tool reference.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  React Frontend │────▶│  Express Backend  │────▶│   SQLite DB  │
│  (Vite, :3000)  │◀────│  (REST + WS,     │◀────│              │
│                 │  WS  │   :3001)          │     └──────────────┘
└─────────────────┘     └──────────────────┘            ▲
                               ▲                        │
                        ┌──────┴───────────┐     ┌─────┴────────┐
                        │  HTTP MCP Agent  │     │  Stdio Agent  │
                        │  (remote MCP)    │     │  (local MCP)  │
                        └──────────────────┘     └──────────────┘
```

- **Frontend**: React 19 + TypeScript, Vite, Context API
- **Backend**: Express 5 + TypeScript, REST + WebSocket
- **Database**: SQLite via better-sqlite3 (zero config)
- **MCP**: Stdio and Streamable HTTP transports

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend port |
| `VIBE_DASH_DB` | `<git-root>/vibe-dash.db` | Database path. Used by the server, the stdio MCP transport, and the CLI alike — all go through the same resolver, so setting it once points all three at one file. |
| `VIBE_DASH_ALLOW_SCHEMA_DRIFT` | unset | Bypasses the guard that refuses to open a database carrying migrations this build does not know (i.e. one written by a newer Vibe Dash). Only for deliberately running an older checkout against a migrated database — expect SQL errors for missing columns. |
| `VIBE_DASH_CLAUDE_HOME` | `~/.claude/projects` | Where to look for Claude Code session transcripts. Point this elsewhere if your Claude Code install keeps them somewhere else, or at an empty directory to switch ingestion off. |

> **The `VIBE_DASH_DB` default is not relative to your current directory.** With
> the variable unset, the path resolves to `vibe-dash.db` at the root of the git
> repository *containing the Vibe Dash install*, not the directory you launched
> from. Every worktree of that repo therefore resolves to the same file, which is
> deliberate — one database, one owner. Set `VIBE_DASH_DB` explicitly if you want
> it anywhere else.

---

## Development

```bash
npm test             # Vitest
npm run test:watch   # Watch mode
npm run build        # Production build
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
```

---

## Team self-hosting

Deploy Vibe Dash on a shared server so all your agents report to the same dashboard:

```bash
git clone https://github.com/sgentzen/vibe-dash.git
cd vibe-dash
docker compose up -d    # dashboard at http://your-server:3001
```

See [docs/self-hosting.md](docs/self-hosting.md) for reverse proxy (Nginx/Caddy), TLS, access control options, backup, and upgrade procedures.

## Roadmap

Vibe Dash narrowed in mid-2026 to its core — a local-first **Dashboard + Kanban +
MCP** for a solo user — and cut the broader platform features (team mode, git
ingestion, intelligence/digests, sprints, reports). The 2026-04 program review
([docs/PROGRAM-REVIEW-2026-04.md](docs/PROGRAM-REVIEW-2026-04.md)) records the
earlier, wider direction and is kept for context; superseded plans live under
[docs/archive/superseded-plans/](docs/archive/superseded-plans/).

## What Vibe Dash is *not*

Vibe Dash is a **local-first, single-user dashboard**, not a SaaS or a team platform. See the [used-open-source-project positioning decision](docs/decisions/2026-08-09-used-oss-project.md), which supersedes the original [portfolio-piece scope cap](docs/decisions/2026-05-strategic-positioning.md), and the [R11.4 deprecation audit](docs/archive/completed-plans/R11.4-feature-deprecation-audit.md). It intentionally does **not** include:

- **Multi-user accounts / team mode** — single-user by design. An optional team flag exists but is not promoted to real auth/RBAC.
- **A cloud or hosted service** — it runs on your machine against local SQLite. No accounts, nothing to sign up for.
- **Git-host sync** (GitHub/GitLab issues, PR mirroring) — Vibe Dash tracks agent work, not your issue tracker.
- **AI digests or natural-language querying** — no LLM summarization layer; the data is yours to query directly over SQLite.
- **Sprints, auto-generated reports, and plugin/template/alert-rule systems** — cut as unused complexity.
- **A desktop tray app (Tauri)** — deferred; the browser tab is the interface.

If you need any of these, Vibe Dash is probably the wrong tool — and that's fine. It optimizes for one thing: giving your local AI agents a shared, real-time task board over MCP.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache 2.0. See [LICENSE](LICENSE).
