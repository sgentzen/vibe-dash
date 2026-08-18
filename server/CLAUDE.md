# Server

Patterns for `server/` — the Express API, SQLite layer, WebSocket broadcast, and ingest pipelines.

## Database Patterns

- **No ORM** — raw SQL with better-sqlite3 prepared statements
- Primary keys: TEXT UUIDs via `randomUUID()`
- Timestamps: ISO 8601 strings (use `new Date().toISOString()`)
- JSON columns for complex data (capabilities, event_types, template_json)
- All DB functions accept `db: Database.Database` as first parameter
- Activity logging: call `logActivity()` after mutations, then `broadcast()` the WebSocket event

## Route Patterns

- Every route gets a rate limiter; reuse the existing ones in `server/routes/` rather than inventing new limits
- Error responses: `{ error: "message" }` with appropriate HTTP status
- All mutation endpoints broadcast WebSocket events for real-time sync
