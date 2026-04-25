#!/usr/bin/env bash
# Generic ingest endpoint example — send any activity, cost, or session event.
# Replace <your-token> with your ingestion source token.
# See docs/GENERIC-INGEST-SCHEMA.md for the full schema reference.

VIBE_URL="${VIBE_DASH_URL:-http://localhost:3001}"
TOKEN="${VIBE_DASH_TOKEN:?Set VIBE_DASH_TOKEN}"

# Activity event (no task_id — agent-only)
curl -X POST "$VIBE_URL/api/ingest/generic" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "activity",
    "agent_name": "my-agent",
    "message": "Starting code generation"
  }'

# Cost event
curl -X POST "$VIBE_URL/api/ingest/generic" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "cost",
    "agent_name": "my-agent",
    "model": "gpt-4o",
    "provider": "openai",
    "input_tokens": 1200,
    "output_tokens": 800,
    "cost_usd": 0.0048
  }'

# Activity linked to a task
curl -X POST "$VIBE_URL/api/ingest/generic" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "activity",
    "agent_name": "my-agent",
    "task_id": "your-task-uuid",
    "message": "Completed implementation"
  }'

# Session start
curl -X POST "$VIBE_URL/api/ingest/generic" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "session_start",
    "agent_name": "my-agent"
  }'

# Heartbeat (keeps source "live" without sending an event)
curl -X POST "$VIBE_URL/api/ingest/generic/heartbeat" \
  -H "Authorization: Bearer $TOKEN"
