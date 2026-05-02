# Vibe Dash

Local-first real-time dashboard for monitoring AI-driven development projects via MCP (Model Context Protocol).

> **Source of truth** for architecture, project structure, and code patterns. README.md and CONTRIBUTING.md link here instead of duplicating these details. MCP integration (transports, tools, setup) lives in [docs/MCP-SETUP.md](docs/MCP-SETUP.md).

## Tech Stack

- **Runtime**: Node.js >=20, ESM (`"type": "module"`)
- **Backend**: Express 5, better-sqlite3, WebSocket (ws)
- **Frontend**: React 19, Vite 8, CSS variables (no UI library)
- **MCP**: @modelcontextprotocol/sdk for tool registration + SSE/stdio transports
- **Language**: TypeScript 6 (strict mode, ES2022 target)
- **Testing**: Vitest with in-memory SQLite (`createTestDb()`)
- **Validation**: Zod (MCP tool schemas)

## Project Structure

```
server/
  index.ts          # Express app, MCP SSE, WebSocket setup (port 3001)
  routes.ts         # All REST API endpoints (Express Router)
  types.ts          # Shared TypeScript interfaces/types
  websocket.ts      # WebSocket broadcast
  recurrence.ts     # Recurring task logic
  db/
    index.ts        # Barrel re-export (all consumers import from here)
    schema.ts       # DDL, migrations, initDb(), openDb()
    helpers.ts      # now(), genId(), parseAgent()
    projects.ts     # createProject, listProjects
    sprints.ts      # CRUD + capacity, daily stats, velocity
    tasks.ts        # CRUD + search, bulk update, recurring tasks
    agents.ts       # CRUD + health, sessions, stats, file locks
    activity.ts     # logActivity, activity stream, heatmap
    blockers.ts     # createBlocker, resolveBlocker
    tags.ts         # tag CRUD + task-tag associations
    dependencies.ts # task dependency graph
    comments.ts     # comments + @mentions
    notifications.ts # alert rules + notifications
    filters.ts      # saved search filters
    templates.ts    # project templates + seeding
    webhooks.ts     # webhook CRUD + fireWebhooks
    reports.ts      # generateReport
    costs.ts        # cost/token tracking per agent/sprint/project
  mcp/
    server.ts       # MCP server factory + tool registration
    tools.ts        # MCP tool handler implementations
    stdio.ts        # MCP stdio transport entry point
src/
  App.tsx           # Main app + initialization
  store.tsx         # Context API + useReducer state management
  types.ts          # Frontend type definitions (mirrors server/types.ts)
  components/       # React components (TaskCard, TaskBoard, DashboardView, etc.)
  hooks/            # useApi, useWebSocket, usePolling
  utils/            # agentColors, helpers
cli/
  index.ts          # Standalone CLI (list, add-task, status, agents)
tests/
  setup.ts          # createTestDb() — in-memory SQLite
  *.test.ts         # Integration tests (no mocking, real DB operations)
```

## Development

```bash
npm run dev          # Concurrent: tsx watch server + vite client
npm run dev:server   # Server only (port 3001)
npm run dev:client   # Vite only (port 3000, proxies /api + /ws to 3001)
npm start            # Production: vite build + tsx server/index.ts (serves at :3001)
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run build        # vite build + tsc --noEmit
npm run mcp:stdio    # Run the MCP stdio transport directly (ad-hoc testing)
```

## Database Patterns

- **No ORM** — raw SQL with better-sqlite3 prepared statements
- Primary keys: TEXT UUIDs via `randomUUID()`
- Timestamps: ISO 8601 strings (use `new Date().toISOString()`)
- JSON columns for complex data (capabilities, event_types, template_json)
- All DB functions accept `db: Database.Database` as first parameter
- Activity logging: call `logActivity()` after mutations, then `broadcast()` the WebSocket event

## Route Patterns

```typescript
router.get("/api/resource", limiter, (req, res) => {
  // 1. Validate params — early return with 400/404
  // 2. Call db function
  // 3. broadcast() WebSocket event (on mutations)
  // 4. fireWebhooks() (on mutations)
  // 5. res.json(result)
});
```

- Rate limiters: `statsLimiter` (30/min), `firstRunLimiter` (10/min), etc.
- Error responses: `{ error: "message" }` with appropriate HTTP status
- All mutation endpoints broadcast WebSocket events for real-time sync

## Frontend Patterns

- **State**: Context API + `useReducer` in `store.tsx` (no Redux library)
- **Data fetching**: `useApi()` hook wraps fetch for REST calls
- **Real-time**: `useWebSocket()` with auto-reconnect (2s delay)
- **Styling**: CSS variables for dark/light theming, inline styles, no CSS modules
- **Components**: Functional with typed props interfaces

## Testing

- Tests in `tests/` directory, named `*.test.ts`
- Each test gets a fresh in-memory DB via `beforeEach(() => { db = createTestDb(); })`
- Integration tests — no mocking, test real DB operations
- Import functions directly from `../server/db/index.js` (note `.js` extension for ESM)

## Conventions

- **Imports**: ESM with explicit `.js` extensions in relative imports
- **Naming**: PascalCase types, camelCase functions, snake_case DB columns/tables
- **Events**: snake_case WebSocket event types (`task_created`, `agent_activity`)
- **CSS vars**: kebab-case (`--bg-primary`, `--accent-red`)
- **Types**: Shared between server and client via parallel `types.ts` files
- **IDs**: Always TEXT UUIDs, never auto-increment integers

## Environment Variables

| Variable | Default | Used by |
|----------|---------|---------|
| `PORT` | `3001` | Express server (`server/index.ts`) |
| `DB_PATH` | `./vibe-dash.db` | Server SQLite path |
| `VIBE_DASH_DB` | `./vibe-dash.db` | Stdio MCP SQLite path — must match `DB_PATH` to share data with the server |
