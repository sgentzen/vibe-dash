# Vibe Dash

A local-first, real-time dashboard for monitoring and managing AI-driven development projects. Gives humans at-a-glance visibility into project status, active work, and blockers — and gives AI agents a structured way to report progress via [MCP](https://modelcontextprotocol.io/).

![License](https://img.shields.io/badge/license-Apache%202.0-blue)

## Why Vibe Dash?

When multiple AI agents work across multiple projects, you lose visibility. Vibe Dash solves this with:

- **A visual dashboard** — Kanban board, analytics, agent activity feed, and burndown charts
- **An MCP server** — AI agents report task status, log activity, flag blockers, and track file conflicts through structured tool calls
- **Real-time sync** — WebSocket-powered updates appear instantly in the browser
- **Local-first storage** — SQLite database, no cloud dependencies, your data stays on your machine

## Quick Start

Requires **Node.js 20+**.

```bash
# Clone and install
git clone https://github.com/sgent/vibe-dash.git
cd vibe-dash
npm install

# Start in development mode (hot-reload)
npm run dev
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001

# Or start in production mode
npm start
# Everything at http://localhost:3001
```

## Connecting AI Agents

Vibe Dash exposes an MCP server that AI coding agents (Claude Code, etc.) can use to report their work. The simplest setup is the stdio transport — add the snippet from [docs/MCP-SETUP.md](docs/MCP-SETUP.md) to your project's `.mcp.json` and restart your agent.

See [docs/MCP-SETUP.md](docs/MCP-SETUP.md) for the full setup guide: stdio / SSE / Streamable HTTP transports, bulk task import, ongoing reporting, and troubleshooting.

## Features

### Dashboard Views

- **Board** — Kanban columns (Planned, In Progress, Done) with task cards showing agent assignments, priority, tags, and progress
- **List** — Filterable table view with sorting and saved filters
- **Dashboard** — Project analytics, burndown charts, sprint capacity
- **Agent Dashboard** — Per-agent metrics, session history, contribution breakdown

### MCP Tools for AI Agents

AI agents can call 30+ tools to manage projects, tasks, sprints, blockers, dependencies, comments, and more. See the full reference in [docs/MCP-SETUP.md](docs/MCP-SETUP.md#step-4-ongoing-task-reporting).

### Real-Time Updates

All changes — whether from the dashboard UI or MCP tool calls — are broadcast over WebSocket and appear instantly across all connected clients.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  React Frontend │────▶│  Express Backend  │────▶│   SQLite DB  │
│  (Vite, :3000)  │◀────│  (REST + WS,     │◀────│              │
│                 │  WS  │   :3001)          │     └──────────────┘
└─────────────────┘     └──────────────────┘            ▲
                               ▲                        │
                               │ SSE                    │ Direct
                        ┌──────┴───────┐         ┌─────┴────────┐
                        │  AI Agent    │         │  AI Agent     │
                        │  (SSE MCP)   │         │  (Stdio MCP)  │
                        └──────────────┘         └──────────────┘
```

- **Frontend**: React 19 + TypeScript, Context API state management, Vite dev server
- **Backend**: Express 5 + TypeScript, REST API + WebSocket server
- **Database**: SQLite via better-sqlite3 (local file, zero config)
- **MCP Server**: Supports stdio (direct DB access), SSE, and Streamable HTTP transports — see [docs/MCP-SETUP.md](docs/MCP-SETUP.md)

## Development

```bash
npm run dev    # Run both frontend (:3000) and backend (:3001) with hot-reload
npm test       # Run the test suite
```

See [CLAUDE.md](CLAUDE.md) for the full module layout, additional dev commands, and architecture/code patterns (database, routes, frontend, testing, conventions).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `DB_PATH` | `./vibe-dash.db` | SQLite database location (server) |
| `VIBE_DASH_DB` | `./vibe-dash.db` | SQLite database location (stdio MCP) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
