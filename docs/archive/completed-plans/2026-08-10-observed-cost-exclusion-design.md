# Excluding self-reported cost from agents we already observe

**Status:** Design approved, not yet planned
**Date:** 2026-08-10
**Follows:** [2026-08-09-transcript-ingestion-design.md](2026-08-09-transcript-ingestion-design.md), shipped in #175

## 1. Context

Transcript ingestion reads Claude Code's session files and records their token
spend. It shipped with a hazard documented but not fixed: the `log_cost` MCP
tool still exists, and any per-project `CLAUDE.md` written before the change
still tells Claude Code to call it. Where that instruction survives, one
session's spend is recorded twice, once by the agent and once from its own
transcript, and every affected total is roughly double.

Migration 019 added a `source` column, `mcp` or `transcript`, so the two are
distinguishable. Nothing consumes it. That column plus this design is what
turns "we can tell them apart afterwards" into "the total is right".

The failure is silent. Nothing in the interface indicates it, and the doubled
figure looks exactly like a real one. For a product whose positioning is
trustworthy numbers, that is the worst available shape of bug.

### 1.1 Why the obvious fix is wrong

The tempting rule is: if transcripts covered a project on a given day, ignore
`mcp` rows for that project and day. It is deterministic and needs no new
schema.

It is also wrong. A user running Claude Code and Cursor against the same
project on the same day would have Cursor's genuinely self-reported spend
silently dropped from every total. Losing real spend and double counting real
spend are the same class of defect: a confidently wrong number. Coarse
time-window precedence trades one for the other rather than fixing anything.

The related per-record variant, matching an `mcp` row to a `transcript` row by
model and timestamp proximity, was already rejected in the ingestion design as
"exactly the machinery that silently produces wrong money figures". That
judgement stands.

## 2. Decisions

### D1. Detect and surface. Never guess.

The system reports where both sources overlap and leaves the resolution to a
person. It never infers that a given agent is Claude Code, and never suppresses
a row on its own initiative.

This matches how the ingestion pipeline already treats every case it cannot
resolve: an unmatched directory stays Unattributed, an unknown model stays
unpriced. Both are visible states rather than silently resolved ones. Overlap
becomes the third member of that set.

**Rejected:** automatic suppression by project and time window, for the
false-positive reason in §1.1.

**Rejected:** deleting the duplicate rows. Removing money records to correct a
reporting defect destroys the audit trail that makes the correction checkable.

### D2. Exclusion is a property of an agent, and it is reversible.

A user marks an agent as *cost observed externally*. From then on, that agent's
`source='mcp'` cost rows are excluded from cost totals at query time. The rows
remain in the database untouched.

One action fixes historical and future rows together, which matters because the
duplicates already exist by the time anyone notices. It is reversible by
unmarking, and it is auditable afterwards because nothing was destroyed.

**Rejected:** a purge endpoint deleting `mcp` rows in a project and date range.
Simpler to implement and needs no query-time filter, but irreversible.

**Rejected:** a warning alone, telling the user to edit their `CLAUDE.md`. That
fixes new spend and leaves every historical total permanently doubled.

### D3. Agent granularity, not per project.

An agent is either observed through its transcripts or it is not. That
property does not vary by project, because the transcript reader covers every
directory the agent works in.

**Rejected:** marking per project-and-agent pair. More precise in principle, but
there is no scenario where the same agent is observed for one project and
self-reporting for another, so the extra dimension only adds ways to configure
it wrongly.

## 3. Goals and non-goals

**Goals**

1. A user who had both sources active can make their totals correct, for past
   and future rows, with one action.
2. Overlap is visible before anyone has to notice a number looks wrong.
3. Nothing is deleted, and nothing is excluded that the user did not
   explicitly mark.

**Non-goals**

Automatic detection of which agent is Claude Code. Deleting cost rows.
Dashboard UI, which is deferred exactly as it was for ingestion. Reconciling
individual rows against each other.

## 4. Making `mcp` rows attributable

This is the part the design depends on and the part that is not obvious from
the outside.

`log_cost` takes `agent_id` as an optional argument and `handleLogCost` ignores
the per-session `agentName` the MCP handler signature already threads through.
A caller that supplies neither produces a cost row attached to no agent. Such a
row can never be excluded by an agent-level rule, because there is no agent to
mark.

`log_cost` therefore resolves the session agent when `agent_id` is absent,
using `touchAgent(db, agentName)`. That is not a new mechanism: `log_activity`
already does exactly this, through `autoLog`, and the README documents
`log_activity` as auto-registering the agent. This makes `log_cost` consistent
with its neighbour rather than introducing a special case.

**Accepted limitation.** A row written with no `agent_id` and no session agent
name remains unattributable and therefore unexcludable. It is counted in the
overlap report so it is visible, but marking an agent will not remove it. This
is documented rather than worked around, because the alternative is guessing
which agent it belonged to.

## 5. Data model, migration 021

One column:

```sql
ALTER TABLE agents ADD COLUMN cost_observed_externally INTEGER NOT NULL DEFAULT 0;
```

Guarded by the same `has(column)` check the existing agent-column migrations
use, so it is safe against a database where it is already present.

`cost_entries` is unchanged. `source` already exists from migration 019, and
`agent_id` already exists from the original schema.

Default `0` means the change is inert until somebody marks an agent, which is
the correct behaviour for an upgrade: no existing total moves on its own.

## 6. The query filter

A single shared SQL fragment, applied to every query in `server/db/costs.ts`
that reads `cost_entries`. There are six such queries today.

```sql
AND NOT (
  cost_entries.source = 'mcp'
  AND cost_entries.agent_id IS NOT NULL
  AND cost_entries.agent_id IN (
    SELECT id FROM agents WHERE cost_observed_externally = 1
  )
)
```

The `IS NOT NULL` guard is load-bearing and must not be removed as redundant.
See the second property below for what happens without it.

Exported as a named constant beside the existing `unpricedSql()` fragment
introduced during the ingestion review, so the two follow one pattern and a
future query cannot silently miss one of them.

Two properties the fragment must preserve, both worth a test:

- A `transcript` row from a marked agent is **not** excluded. Only `mcp` rows
  are, because the point is to drop the duplicate self-report and keep the
  observation.
- A row with `agent_id IS NULL` is **not** excluded. This needs an explicit
  `agent_id IS NOT NULL` guard in the condition and does NOT come for free:
  `NULL IN (<non-empty subquery>)` evaluates to SQL NULL rather than FALSE,
  `NOT (... AND NULL)` is NULL, and a WHERE clause treats NULL as not-true, so
  without the guard every self-report that named no agent would vanish from
  the totals the moment any agent was marked. That is real spend disappearing.
  It is the accepted limitation in §4 and it gets a test, precisely because it
  is not an accident of SQL semantics that can be relied on.

## 7. Detection and surfacing

`GET /api/ingest/status` gains an `overlaps` array. An entry is emitted for
each project and calendar day that has at least one `transcript` row and at
least one `mcp` row:

```json
{
  "project_id": "…",
  "project_name": "vibe-dash",
  "date": "2026-08-10",
  "mcp_agents": ["claude", "cursor-bot"],
  "mcp_entries": 12,
  "transcript_entries": 40
}
```

Naming the `mcp`-side agents is what makes a false positive cheap. A user who
sees `cursor-bot` knows immediately that this overlap is two tools genuinely
working on one project, not a duplicate, and does nothing. A user who sees
their Claude Code agent knows to mark it.

Day granularity is chosen because the dashboard already groups spend by day, so
the report lines up with the figure a user would be looking at when they
noticed something wrong.

An agent already marked as observed is not reported as an overlap, since its
rows no longer reach any total.

## 8. Setting the flag

```
POST /api/agents/:id/cost-observed   { "observed": true | false }
```

Returns the updated agent. Broadcasts `agent_registered` with the updated agent
as its payload, matching the convention that every mutation endpoint
broadcasts. Rate limited, like the other mutation routes.

`agent_registered` rather than a new `agent_updated` type, because that is
already how this codebase publishes current agent state rather than first
registration specifically: `autoLog` broadcasts it on every `touchAgent` call,
including for agents that have existed for weeks. Adding a second event
carrying the same payload for the same purpose would give the client two things
to handle identically.

A missing agent is a 404. A missing or non-boolean `observed` is a 400. No
other validation: marking an agent that has no `mcp` rows is harmless and
pointless rather than an error, and refusing it would mean the endpoint's
behaviour depends on data that can change under it.

## 9. Error handling

There is little to go wrong here, which is itself worth stating: the change is
one column, one SQL fragment, one read-only report and one setter. It performs
no filesystem access, no parsing and no network calls.

The one real risk is a cost query that forgets the fragment and therefore keeps
double counting. That is addressed structurally in §6 by making the fragment a
shared named constant rather than a string repeated six times, and by a test
that asserts every exported cost function honours it.

## 10. Testing

- A marked agent's `mcp` rows disappear from all six cost totals, and its
  `transcript` rows do not.
- Unmarking restores them, proving reversibility rather than assuming it.
- A row with `agent_id IS NULL` is unaffected by any marking.
- Overlap detection fires for a project with both sources on one day, and stays
  quiet when the two sources fall on different days.
- Overlap detection names every distinct `mcp`-side agent, including the case
  of two different agents on the same day.
- A marked agent stops appearing in the overlap report.
- `log_cost` with no `agent_id` but a session agent name resolves and attaches
  that agent; with neither, it still writes a row and that row is reported in
  overlaps.
- The setter returns 404 for an unknown agent and 400 for a non-boolean.

## 11. Documentation

- `docs/ingestion.md`: replace the "Upgrading from an earlier version" section's
  current advice, which is only "remove the `log_cost` step". It gains the
  second half: mark the agent as observed to correct the rows already recorded.
- `README.md`: the `log_cost` tool description in the MCP table should say it is
  ignored for agents marked as observed.
- Migration 019's comment says the `source` column "does not deduplicate
  anything today". Once this ships that is no longer true, and it should say
  what now consumes it.

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A cost query is added later without the fragment, silently reintroducing double counting | Medium | The fragment is a shared constant, and a test asserts every exported cost function honours it. A new query that skips it fails that test. |
| A user marks the wrong agent and loses real self-reported spend from totals | Low | Reversible by unmarking, and nothing is deleted, so the rows return intact. The overlap report names agents specifically so the choice is informed. |
| Rows with no `agent_id` stay double counted | Low | Documented in §4 and surfaced in the overlap report rather than hidden. Resolving them would require guessing an owner. |
| Users never look at `/api/ingest/status` and so never see the overlap | Medium | Real, and not solved here. Surfacing it on the dashboard is deferred to the same follow-up that surfaces unpriced and unattributed counts. |

## 13. Success criteria

1. With both sources active and the agent marked, cost totals match what the
   transcripts alone report.
2. Unmarking the agent restores the previous totals exactly.
3. `GET /api/ingest/status` reports an overlap before any total is corrected,
   and stops reporting it once the agent is marked.
4. No cost row is deleted at any point.
5. A fresh install with no agent marked behaves exactly as it does today.

---

## 14. Amendment: the mark is keyed to the client, not the agent row

**Added 2026-08-10, after the final whole-branch review. This supersedes D3 and
§5 above; both are left in place so the reasoning that failed stays readable.**

### 14.1 What the review found

D3 said "an agent is either observed through its transcripts or it is not",
and §5 therefore hung the flag on a row in `agents`. That assumed an agent has
one stable row. In this deployment it does not.

`server/mcp/server.ts:28` computes a connection suffix, falling back to
`randomUUID().slice(0, 8)` when the transport supplies no connection id, which
is the stdio path Claude Code uses. Line 40 then names the agent
`${clientName}-${suffix}`. `registerAgent` dedupes on `name_normalized`, so
every launch produces a distinct row with a distinct id.

The consequence is that marking an agent excludes one session's rows. A user
marks `claude-code-a1b2c3d4`, watches the doubled total halve and concludes it
is fixed. The next session is `claude-code-9f8e7d6c`, unmarked, and counts
twice again. Goal 1 promised past and future rows corrected with one action.
As built it delivers neither: past duplicates are spread across one row per
past session, so they need one mark each too.

That is worse than the bug being fixed, because it is silent and it is
accompanied by documentation telling the user the problem is solved.

### 14.2 The correction

The suffix exists for a real reason: two Claude Code windows open at once
should be two agents, with their own sessions and activity. Making the name
stable would break that. So the agent row stays per-connection, and the mark
moves to the thing that is actually stable.

`server/mcp/server.ts` already holds the client name and the suffix as separate
values before it joins them. The client name is recorded rather than recovered
later:

```sql
ALTER TABLE agents ADD COLUMN client_name TEXT;
```

An agent's **cost identity** is `COALESCE(client_name, name)`. For an agent
registered through an MCP connection that is the client name, stable across
every launch. For an agent that named itself through `register_agent` or
`log_activity` it is its own name, which was already stable. One rule covers
both without a special case.

Marking is then a property of an identity:

```sql
CREATE TABLE cost_observed_identities (
  identity  TEXT PRIMARY KEY,
  marked_at TEXT NOT NULL
);
```

and the exclusion condition resolves through it:

```sql
NOT (
  cost_entries.source = 'mcp'
  AND cost_entries.agent_id IS NOT NULL
  AND cost_entries.agent_id IN (
    SELECT a.id FROM agents a
    WHERE COALESCE(a.client_name, a.name) IN (
      SELECT identity FROM cost_observed_identities
    )
  )
)
```

The `agent_id IS NOT NULL` guard stays load-bearing for the reason given in §6.

**Rejected:** deriving the stem by stripping a trailing `-[0-9a-f]{8}` from the
agent name. It needs no new column and would work on rows written before this
change, which is its whole appeal. It is also a guess, and it is wrong for any
agent legitimately named that way. This design's first decision is that the
system never guesses about money, and a rule that is right almost always is
exactly the shape of thing that produces a confidently wrong total.

**Rejected:** propagating the flag to new agents whose name resembles a marked
agent's. Same objection, with the added defect that it marks rows the user
never marked.

### 14.3 What this does not fix, stated plainly

An agent row written before this change has no `client_name`, so its identity
is its full suffixed name. Marking it covers that row and no other. Historical
duplicates from earlier sessions therefore still need one mark each.

There is no backfill, because the only available backfill is the stem-stripping
guess rejected above. This is a real limitation for anyone upgrading with
existing duplicates, it is the same population §11's upgrade advice addresses,
and the documentation must say so rather than let the identity mechanism imply
a completeness it does not have.

### 14.4 Consequences for the shipped surface

- Migration 021 is amended in place rather than corrected by a later migration.
  It has not run against any database, so there is nothing deployed to migrate.
  `agents.cost_observed_externally` is replaced by `client_name` and the new
  table.
- `Agent.cost_observed_externally` remains in the API response, computed by
  join rather than stored, so no client has to learn a new shape.
- `POST /api/agents/:id/cost-observed` keeps its path and body, and additionally
  returns the identity it marked. A user who marks one agent and silently gets
  coverage of every session sharing its client name should be told that is what
  happened.
- The overlap report gains the identity alongside `mcp_agent_names`, so the
  value to mark is visible where the problem is reported rather than deduced.

### 14.5 Additional findings from the same review, carried into this work

- A marked agent's own cost summary reads `$0.00`. Transcript rows are inserted
  with `agent_id NULL`, so `getAgentCostSummary` and `getCostByAgent` show the
  heaviest spender as free once its self-reports stop counting. The agent view
  needs a signal distinguishing this from a genuinely idle agent.
- The overlap query requires `project_id IS NOT NULL`, but `log_cost` takes an
  optional project and this work attaches an agent rather than a project. A
  project-less `mcp` row is invisible to the report yet fully counted in global
  totals, so an entry disappearing confirms less than §11's advice claims.
- `registerAgent` updates on a normalised-name match and preserves the mark, so
  a different tool registering under a marked name inherits suppression of its
  genuine spend. Keying on identity narrows this rather than removing it.
