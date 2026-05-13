# ADR: Agent Name Normalization Strategy

**Status:** Accepted  
**Date:** 2026-05-03

## Context

Vibe Dash agents are registered by name via MCP tool calls. The same logical agent (e.g., Claude Code) can be registered under multiple case/separator variants:

- `"Claude"`, `"claude"`, `"CLAUDE"`
- `"Claude Code"`, `"claude_code"`, `"claude-code"`

Because the `agents` table used a case-sensitive `WHERE name = ?` lookup with a `UNIQUE(name)` constraint, each variant created a separate row. This resulted in:

- Multiple phantom agent entries for the same tool
- Fragmented sessions, costs, and activity history
- Confusing Agents view showing 0 sessions alongside 8 completions (data split across rows)

## Decision

**Option A — Normalize on ingest (chosen)**

Apply a deterministic normalization rule at the point of registration/lookup:

```
normalized = lower(trim(input)).replace(/[_-]+/g, " ").replace(/\s+/g, " ")
```

Examples:
| Input | Normalized |
|-------|-----------|
| `"Claude"` | `"claude"` |
| `"claude_code"` | `"claude code"` |
| `"Claude Code"` | `"claude code"` |
| `"  claude-code  "` | `"claude code"` |

The **display name** (original `name` column) is preserved unchanged for the UI. The normalized form lives in a new `name_normalized` column with a `UNIQUE INDEX`.

**Option B — Surface duplicates in UI for manual merge** — rejected. Puts burden on users; normalization is always correct here since variant spellings are unintentional, not deliberate distinct identities.

## Implementation

1. `normalizeAgentName(name: string): string` added to `server/db/helpers.ts` — single source of truth for the rule.
2. Migration `007_agents_name_normalized`: adds `name_normalized TEXT` column + SQL backfill.
3. Migration `008_agents_dedup_normalized`: for each normalized collision, keeps the oldest-registered agent (survivor), reassigns all FK references (activity_log, agent_sessions, agent_file_locks, tasks.assigned_agent_id, cost_entries, task_reviews, task_comments, agents.parent_agent_id), deletes duplicates, then creates `UNIQUE INDEX idx_agents_name_normalized`.
4. `registerAgent`, `getAgentByName`, `touchAgent` updated to compute and query via `name_normalized`.

## Consequences

- Existing duplicate rows collapsed; historical data (activity, costs, sessions) preserved on the survivor.
- Display names remain as originally supplied — UI continues showing e.g. `"Claude Code"`.
- New registrations with any case/separator variant resolve to the same agent row.
- The normalization rule is intentionally simple (lowercase + trim + separator collapse). Abbreviation expansion (e.g. `"cc"` → `"claude code"`) is out of scope.
