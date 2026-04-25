# Migration Notes — R11

## Breaking Changes

### Removed: `saved_filters` API endpoints

The following endpoints have been removed. They had no frontend consumer and URL-parameter filtering in `search_tasks` covers the same use case.

```
GET    /api/filters
POST   /api/filters
DELETE /api/filters/:id
```

**Migration:** Use `GET /api/tasks/search` with query parameters instead.

### Removed: MCP tools (none in R11)

No MCP tools were removed in R11. `suggest_agent` is deprecated and will be removed in R12.

### Removed: OpenAPI spec endpoint

The `/api/openapi.json` and `/api/docs` endpoints have been removed. The spec was stale (covering ~14 of 60+ endpoints) and wired only to the legacy router. A full regeneration from Zod schemas is planned for R13.

---

## Deprecation Warnings (removal in R12)

### `suggest_agent` MCP tool

This tool is deprecated. It returns `null` for projects without `completion_metrics` data. After R11.3's ingestion system provides real usage data, a replacement based on ingestion-derived performance will be designed.

### `alert_rules` (REST endpoints + DB table)

The alert rules system (`GET/POST/PATCH/DELETE /api/alert-rules`) is deprecated. Its notification generation is narrower than webhooks (only 3 event types vs all events). Migrate to:
- **Webhooks** (`/api/webhooks`) for external HTTP notifications
- **Notifications** (`/api/notifications`) will continue to work via the webhook path

---

## New in R11

### R11.1: Multi-project fleet view

New `OrchestrationView` as the default landing page. Passive project discovery (`GET /api/fleet`).

### R11.2: Cost Intelligence v2

Per-task ROI, cost-per-milestone scorecards, anomaly detection, cross-project leaderboards.

### R11.3: Cross-platform agent ingestion

New ingestion endpoints for automatic agent activity without MCP opt-in:

```
POST   /api/ingest/:source_kind    # claude_code | cursor | codex | copilot | aider | generic
POST   /api/ingest/sources         # create a source, get one-time token
GET    /api/ingest/sources         # list sources
DELETE /api/ingest/sources/:id     # remove source
POST   /api/ingest/sources/:id/rotate  # rotate token
GET    /api/ingest/events          # debug/replay event log
```

New MCP tools: `list_ingestion_sources`, `create_ingestion_source`, `rotate_ingestion_token`.

See `integrations/` directory for platform-specific setup guides.
