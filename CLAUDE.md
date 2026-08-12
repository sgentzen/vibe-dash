# Vibe Dash

Local-first real-time dashboard for monitoring AI-driven development projects via MCP (Model Context Protocol).

> **Source of truth** for this repo's code patterns and conventions — the things the code alone won't teach you. Stack, layout, and scripts are deliberately not duplicated here: read `package.json` and the tree. MCP integration (transports, tools, setup) lives in [docs/MCP-SETUP.md](docs/MCP-SETUP.md).

## Database Patterns

- **No ORM** — raw SQL with better-sqlite3 prepared statements
- Primary keys: TEXT UUIDs via `randomUUID()`
- Timestamps: ISO 8601 strings (use `new Date().toISOString()`)
- JSON columns for complex data (capabilities, event_types, template_json)
- All DB functions accept `db: Database.Database` as first parameter
- Activity logging: call `logActivity()` after mutations, then `broadcast()` the WebSocket event

## Route Patterns

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
| `VIBE_DASH_DB` | `<git-root>/vibe-dash.db` | SQLite path for the server, stdio MCP, and CLI alike (all go through `resolveDbPath()`). Set it once to share one DB across all three. |
| `VIBE_DASH_ALLOW_SCHEMA_DRIFT` | unset | Bypasses the guard that refuses to open a DB carrying migrations this build doesn't know (i.e. one written by a newer Vibe Dash). Only for running an older checkout against a migrated DB on purpose — expect SQL errors for missing columns. |
| `VIBE_DASH_OTLP_SERIES_CAP` | `10000` | Ceiling on rows in `otlp_series` (`server/ingest/otlp/series.ts`). Only the CREATION of a new series is refused; nothing is ever deleted, so an established sender is never affected. Exists so a flooded install can recover without a rebuild. |
| `VIBE_DASH_CLAUDE_HOME` | `~/.claude/projects` | Where transcript ingestion looks for Claude Code session files (`server/ingest/transcripts/discover.ts`). Point it at an empty directory to switch ingestion off. |
