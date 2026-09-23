# Vibe Dash

Local-first real-time dashboard for monitoring AI-driven development projects via MCP (Model Context Protocol).

> **Source of truth** for this repo's code patterns and conventions — the things the code alone won't teach you. Stack, layout, and scripts are deliberately not duplicated here: read `package.json` and the tree. MCP integration (transports, tools, setup) lives in [docs/MCP-SETUP.md](docs/MCP-SETUP.md).

## Testing

- Tests in `tests/` directory, named `*.test.ts`
- Each test gets a fresh in-memory DB via `beforeEach(() => { db = createTestDb(); })`
- Integration tests — no mocking, test real DB operations

## Conventions

- **Imports**: ESM with explicit `.js` extensions in relative imports
- **Naming**: PascalCase types, camelCase functions, snake_case DB columns/tables
- **Events**: snake_case WebSocket event types (`task_created`, `agent_activity`)
- **CSS vars**: kebab-case (`--bg-primary`, `--accent-red`)
- **Types**: Shared between server and client via parallel `types.ts` files

## Environment Variables

| Variable | Default | Used by |
|----------|---------|---------|
| `PORT` | `3001` | Express server (`server/index.ts`) |
| `HOST` | `127.0.0.1` | Interface the Express server binds (`server/index.ts`). Vibe Dash has no authentication, so this stays loopback-only by default; `HOST=0.0.0.0` is the deliberate opt-in for operators fronting it with their own reverse proxy or firewall (the Docker image sets it internally — see `docker-compose.yml`, which keeps the *host-visible* boundary loopback via its port publish instead). |
| `VIBE_DASH_ALLOWED_HOSTS` | unset | Comma-separated `host[:port]` values, exactly as a reverse proxy forwards them in `Host`, added to the loopback allow-list that `server/security/origin.ts` enforces on `/api`, `/mcp`, `/v1/metrics` and the `/ws` upgrade. Both `http://` and `https://` are accepted as the matching `Origin`. See `docs/self-hosting.md`, "Access control". |
| `VIBE_DASH_DB` | `<git-root>/vibe-dash.db` | SQLite path for the server, stdio MCP, and CLI alike (all go through `resolveDbPath()`). Set it once to share one DB across all three. |
| `VIBE_DASH_ALLOW_SCHEMA_DRIFT` | unset | Bypasses the guard that refuses to open a DB carrying migrations this build doesn't know (i.e. one written by a newer Vibe Dash). Only for running an older checkout against a migrated DB on purpose — expect SQL errors for missing columns. |
| `VIBE_DASH_OTLP_SERIES_CAP` | `10000` | Ceiling on rows in `otlp_series` (`server/ingest/otlp/series.ts`). Only the CREATION of a new series is refused; nothing is ever deleted, so an established sender is never affected. Exists so a flooded install can recover without a rebuild. |
| `VIBE_DASH_CLAUDE_HOME` | `~/.claude/projects` | Where transcript ingestion looks for Claude Code session files (`server/ingest/transcripts/discover.ts`). Point it at an empty directory to switch ingestion off. |
| `VIBE_DASH_ALLOW_SHARED_DB` | unset | Bypasses the advisory owner lock (`server/db/ownerLock.ts`) that `openDb()` takes for read-write opens by the server and the stdio MCP process (ARCH-1). Only for a deliberate shared-DB setup: the corruption risk the lock exists to catch is real. |
