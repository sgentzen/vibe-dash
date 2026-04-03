# Vibe Dash

Local-first real-time dashboard for monitoring AI-driven development projects via MCP (Model Context Protocol).

## Tech Stack

- **Runtime**: Node.js >=18, ESM (`"type": "module"`)
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
  db.ts             # Database layer — schema + all queries (being split in Sprint 1)
  types.ts          # Shared TypeScript interfaces/types
  websocket.ts      # WebSocket broadcast
  recurrence.ts     # Recurring task logic
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
npm test             # vitest run
npm run build        # vite build + tsc --noEmit
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
- Import functions directly from `../server/db.js` (note `.js` extension for ESM)

## Conventions

- **Imports**: ESM with explicit `.js` extensions in relative imports
- **Naming**: PascalCase types, camelCase functions, snake_case DB columns/tables
- **Events**: snake_case WebSocket event types (`task_created`, `agent_activity`)
- **CSS vars**: kebab-case (`--bg-primary`, `--accent-red`)
- **Types**: Shared between server and client via parallel `types.ts` files
- **IDs**: Always TEXT UUIDs, never auto-increment integers
