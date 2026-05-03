# Vibe Dash

**The open-source project layer for AI-driven development.**

Connect your AI coding agents — Claude Code, Cursor, Codex, Copilot, Aider — to a shared task board, activity feed, and cost tracker. One dashboard, all your agents, no accounts required.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

---

## What it does

When multiple AI agents work across multiple projects, you lose visibility into what's happening, what's blocked, and what it's costing you. Vibe Dash gives your agents a shared workspace:

- **Task board** — agents claim tasks, log progress, and flag blockers through MCP tool calls
- **Activity feed** — every agent action appears in real time; no polling needed
- **Cost tracker** — per-agent and per-model token spend logged automatically
- **Conflict detection** — agents declare which files they're editing; you see collisions before they happen
- **Local-first** — SQLite on your machine, no cloud, no subscriptions

---

## Quick Start

Requires **Node.js 20+**.

```bash
git clone https://github.com/sgent/vibe-dash.git
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

| Agent | Guide |
|-------|-------|
| Claude Code | [docs/integrations/claude-code.md](docs/integrations/claude-code.md) |
| Cursor | [docs/integrations/cursor.md](docs/integrations/cursor.md) |
| OpenAI Codex | [docs/integrations/codex.md](docs/integrations/codex.md) |
| GitHub Copilot | [docs/integrations/copilot.md](docs/integrations/copilot.md) |
| Aider | [docs/integrations/aider.md](docs/integrations/aider.md) |

All agents connect over MCP. Three transports are available:

| Transport | URL / Command | Best for |
|-----------|--------------|---------|
| **Stdio** | `npx tsx /path/to/vibe-dash/server/mcp/stdio.ts` | Single-machine, offline-first |
| **Streamable HTTP** | `http://localhost:3001/mcp` | Multi-agent, remote, modern clients |
| **SSE (legacy)** | `http://localhost:3001/sse` | Older MCP clients |

Full setup guide with task import, CLAUDE.md snippets, and troubleshooting: [docs/MCP-SETUP.md](docs/MCP-SETUP.md).

---

## Dashboard views

- **Board** — Kanban (Planned / In Progress / Done) with agent assignments, priority, tags, and progress bars
- **List** — Filterable, sortable table with saved filters
- **Analytics** — Burndown charts, sprint capacity, velocity trends
- **Agent Dashboard** — Per-agent metrics, session history, cost breakdown by model

---

## MCP tools (30+)

Core tools your agents will use most:

| Tool | Purpose |
|------|---------|
| `create_project` | Register a project |
| `list_tasks` / `search_tasks` | Find work |
| `create_task` / `update_task` / `complete_task` | Manage tasks |
| `log_activity` | Post a status update (auto-registers the agent) |
| `report_blocker` / `resolve_blocker` | Flag and clear blockers |
| `report_working_on` | Declare files being edited (conflict detection) |
| `log_cost` | Record token spend |
| `create_sprint` / `generate_report` | Sprint management |

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
                        │  HTTP/SSE Agent  │     │  Stdio Agent  │
                        │  (remote MCP)    │     │  (local MCP)  │
                        └──────────────────┘     └──────────────┘
```

- **Frontend**: React 19 + TypeScript, Vite, Context API
- **Backend**: Express 5 + TypeScript, REST + WebSocket
- **Database**: SQLite via better-sqlite3 (zero config)
- **MCP**: Stdio, Streamable HTTP, and SSE transports

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend port |
| `VIBE_DASH_DB` | `./vibe-dash.db` | Database path — used by both the server and stdio MCP transport |

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
git clone https://github.com/sgent/vibe-dash.git
cd vibe-dash
docker compose up -d    # dashboard at http://your-server:3001
```

See [docs/self-hosting.md](docs/self-hosting.md) for reverse proxy (Nginx/Caddy), TLS, access control options, backup, and upgrade procedures.

## Roadmap

The current strategic direction and active milestones (R11–R13) are documented in
[docs/PROGRAM-REVIEW-2026-04.md](docs/PROGRAM-REVIEW-2026-04.md). This is the
primary guiding document for all roadmap decisions until the next program review.

## Roadmap

The current strategic direction and active milestones (R11–R13) are documented in
[docs/PROGRAM-REVIEW-2026-04.md](docs/PROGRAM-REVIEW-2026-04.md). This is the
primary guiding document for all roadmap decisions until the next program review.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache 2.0. See [LICENSE](LICENSE).
