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

Requires **Node.js 18+**.

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

Vibe Dash exposes an MCP server that AI coding agents (Claude Code, etc.) can use to report their work.

### Stdio Transport (recommended)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "command": "npx",
      "args": ["tsx", "/path/to/vibe-dash/server/mcp/stdio.ts"]
    }
  }
}
```

### SSE Transport (remote/multi-agent)

Start the Vibe Dash server, then add to `.mcp.json`:

```json
{
  "mcpServers": {
    "vibe-dash": {
      "url": "http://localhost:3001/sse"
    }
  }
}
```

See [docs/MCP-SETUP.md](docs/MCP-SETUP.md) for the full setup guide including bulk task import, ongoing reporting, and troubleshooting.

## Features

### Dashboard Views

- **Board** — Kanban columns (Planned, In Progress, Done) with task cards showing agent assignments, priority, tags, and progress
- **List** — Filterable table view with sorting and saved filters
- **Dashboard** — Project analytics, burndown charts, sprint capacity
- **Agent Dashboard** — Per-agent metrics, session history, contribution breakdown

### MCP Tools for AI Agents

| Tool | Purpose |
|------|---------|
| `list_projects` | List all projects |
| `create_project` | Register a new project |
| `list_tasks` | List tasks with optional filters |
| `search_tasks` | Search tasks by query |
| `create_task` | Create a task with status and priority |
| `update_task` | Update task fields (status, progress, etc.) |
| `complete_task` | Mark a task done |
| `log_activity` | Log a status update (auto-registers agent) |
| `report_blocker` | Flag a task as blocked with reason |
| `resolve_blocker` | Clear a blocker |
| `assign_task` | Assign a task to an agent |
| `add_dependency` | Create task dependencies |
| `report_working_on` | Declare files being edited (conflict detection) |
| `create_sprint` | Create and manage sprints |
| `generate_report` | Generate project/sprint reports |

See the full list of 30+ tools in the [MCP setup guide](docs/MCP-SETUP.md).

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
- **MCP Server**: Supports stdio (direct DB access) and SSE (HTTP) transports

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build

# Start individual components
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
```

### Project Structure

```
vibe-dash/
├── src/                  # React frontend
│   ├── components/       # UI components (TopBar, TaskBoard, AgentDashboard, etc.)
│   ├── hooks/            # useApi, useWebSocket, usePolling
│   ├── store.tsx         # Global state (Context + useReducer)
│   └── types.ts          # Shared TypeScript types
├── server/               # Node.js backend
│   ├── index.ts          # Express server entry
│   ├── db.ts             # SQLite database layer
│   ├── routes.ts         # REST API routes
│   ├── websocket.ts      # WebSocket server
│   └── mcp/              # MCP server (stdio + SSE)
├── tests/                # Vitest test suite
└── docs/                 # Documentation
```

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
