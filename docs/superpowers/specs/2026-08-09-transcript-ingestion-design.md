# Trustworthy cost and activity from local Claude Code transcripts

**Status:** Design approved, not yet planned
**Date:** 2026-08-09
**Supersedes:** [docs/decisions/2026-05-strategic-positioning.md](../../decisions/2026-05-strategic-positioning.md) (the "portfolio piece" scope cap)

## 1. Context

Every number on the Vibe Dash dashboard exists because an agent chose to call an
MCP tool. Tasks move when an agent calls `update_task`, spend appears when an
agent calls `log_cost`, and an agent looks alive because it called `heartbeat`.
Nothing verifies any of it.

That is the product's central weakness, and it is not hypothetical. The
repository ships per-agent `CLAUDE.md` snippets whose only purpose is to nag
agents into reporting, and the owner's own global instructions carry a task
protocol plus a stop hook for the same reason. Enforcement machinery of that
size is evidence that voluntary reporting does not hold on its own.

Competitors split cleanly into two groups, and neither closes the gap:

- **Self-reported boards** (vibe-kanban, Backlog.md, claude-task-master,
  Nimbalyst) have a task model and the same trust problem.
- **Passive meters** (ccusage at 17.8k stars, the OpenTelemetry stacks) read real
  data without cooperation, but have no task model at all, so they can tell you
  what you spent and never what it was for.

Nobody occupies the overlap. That is the opportunity this design takes.

### 1.1 Market timing

The two largest projects in the category have gone quiet. Bloop shut down on
2026-04-10 and vibe-kanban (27.7k stars, 2.9k forks, 534 open issues) is
formally sunsetting as community maintained, with no commits since 2026-04-24.
claude-task-master (27.9k stars) has been quiet since 2026-04-28. Crystal is
deprecated. The commercial leader, Conductor, is closed source and macOS only.

Two cautions belong next to that. Bloop's stated reason for shutting down was
that it could not find a business model, so the quiet is a warning about
monetisation, not proof the problem is solved. And a sunsetting project's users
are not automatically winnable.

## 2. Decisions

Four decisions were taken during design. Each is recorded with the alternative
that lost, so a future reader can tell whether changed circumstances should
reopen it.

### D1. Vibe Dash is now a used open-source project, not a portfolio piece

The 2026-05 decision capped scope at "portfolio piece" and gave every future
call the test: *does this make the demo better, or only matter to a paying
customer?* That cap is lifted. Adoption now counts, which makes discoverability,
durability and contributor experience legitimate concerns where previously they
were out of scope.

**Rejected:** keeping the portfolio cap and publishing the competitive analysis
as one of the two long-form posts the old decision already listed as exit
criteria. That remains a good idea and is not blocked by this change.

### D2. The wedge is trustworthy data, alongside any runner

Vibe Dash observes and coordinates. It does not launch agents into worktrees,
review diffs, or merge. Positioning is explicitly *beside* whatever runner the
user prefers.

**Rejected:** building execution to become the direct vibe-kanban replacement.
That means competing on the strongest axis of Nimbalyst, Conductor, Agent Kanban
and container-use, from behind, with one maintainer. It is also the axis a
funded competitor defends most easily.

**Rejected:** leading with a git-native markdown task store. It answers
Backlog.md, the healthiest project in the category, but the niche is occupied
and the differentiation is thinner.

### D3. v1 ingests local transcripts only

Read `~/.claude/projects/**/*.jsonl` directly, the same source ccusage uses.

The deciding property is that it requires **no configuration at all**: no
environment variables, no `settings.json` edits, nothing to wire up. It is also
retroactive. A survey of the development machine on 2026-08-09 found 1,093
transcript files, with 3,180 assistant records carrying `message.usage`, so a
first run has real history to show immediately rather than an empty dashboard.

Accepted costs: it is Claude Code specific, and the JSONL format is undocumented
and may change without notice. Section 8 covers how the design contains that.

**Rejected for v1:** Claude Code hooks. A more stable, documented contract and
the right source for a live edge, but it needs a `settings.json` snippet
installed per project, which forfeits the zero-configuration property.

**Rejected for v1:** an OTLP receiver for Claude Code's built-in OpenTelemetry
export. The most standard route and the only one with a story for non-Claude
tools, but it needs per-machine environment setup, a protobuf endpoint in the
server, and it yields nothing until switched on.

Both remain good follow-ups. Neither belongs in the first cut.

### D4. Cost sources are tagged, and transcripts win

`cost_entries` gains a `source` column. Rows ingested from transcripts are
authoritative for Claude Code. `log_cost` survives for agents that cannot be
observed, such as Cursor, Codex, Aider and anything custom.

Without this, the two paths double count: an obedient Claude Code agent calls
`log_cost` and the same spend is then ingested from its transcript.

**Rejected:** removing `log_cost` entirely. It strands every non-Claude-Code
agent, which is precisely the cross-tool audience the README advertises.

**Rejected:** storing both and reconciling in the cost queries by matching model,
time window and project. Fuzzy timestamp matching is exactly the machinery that
silently produces wrong money figures, which is the opposite of the wedge.

## 3. Goals and non-goals

**Goals**

1. Per-project, per-model token and cost figures that are correct whether or not
   any agent cooperated.
2. Idempotent ingestion. Re-scanning never changes a total.
3. Zero configuration for the default Claude Code layout.
4. Spend that cannot be attributed is visible as unattributed, never discarded
   and never guessed.

**Non-goals for v1**

Claude Code hooks. An OTLP receiver. Readers for other agents. Staleness
detection. Task-level cost attribution. Fetching prices over the network.

Staleness detection, meaning a task claimed in progress with no observed
activity behind it, is the eventual differentiator and the reason this work
matters strategically. It is out of v1 because it needs agent-to-session
linkage that transcripts do not carry. Approximating that linkage from
timestamps would produce confident wrong answers, which would damage the exact
property being built.

## 4. Architecture

A single deep module, `server/ingest/transcripts/`, with one public entry point:

```ts
syncTranscripts(db: Database.Database, opts?: SyncOptions): Promise<SyncResult>
```

Everything else is internal to the module.

| File | Responsibility |
|---|---|
| `discover.ts` | Enumerate `*.jsonl` under the Claude home, including `subagents/` |
| `parse.ts` | Stream one file, yield `UsageRecord`, tolerate malformed lines |
| `pricing.ts` | Model identifier to rates; tokens to USD |
| `attribute.ts` | `cwd` to `project_id` |
| `sync.ts` | Orchestration, incremental cursor, transaction boundaries |

`server/routes/ingest.ts` exposes `POST /api/ingest/scan` and
`GET /api/ingest/status`. Both follow the existing route conventions: a rate
limiter, `{ error: "message" }` bodies, and a WebSocket broadcast after any
mutation.

The Claude home is `VIBE_DASH_CLAUDE_HOME` when set, otherwise
`<homedir>/.claude/projects`. Making it an environment variable is what allows
tests to run against fixtures without touching the real home directory.

## 5. Data model, migration 019

Following the repository's existing migration conventions: raw SQL, TEXT UUID
primary keys, ISO 8601 timestamps, snake_case columns.

**`cost_entries` gains four columns.**

| Column | Type | Purpose |
|---|---|---|
| `source` | TEXT NOT NULL DEFAULT `'mcp'` | `'mcp'` or `'transcript'` |
| `external_id` | TEXT | The transcript record `uuid`; NULL for MCP rows |
| `cache_creation_tokens` | INTEGER NOT NULL DEFAULT 0 | Cache write tokens |
| `cache_read_tokens` | INTEGER NOT NULL DEFAULT 0 | Cache read tokens |

Plus a partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_entries_external_id
  ON cost_entries(external_id) WHERE external_id IS NOT NULL;
```

The partial index is what makes re-scanning safe, and it leaves existing MCP rows
untouched because they carry NULL.

Storing all four token classes is deliberate. Anthropic prices cache writes and
cache reads differently from ordinary input, so collapsing them into
`input_tokens` would leave `cost_usd` unauditable. A cost figure nobody can
check is not a trustworthy cost figure.

**`project_paths`** maps directories to projects.

```
id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
```

A separate table rather than a column on `projects`, because one project has
many directories once git worktrees are in use, which is this project's own
normal working pattern.

**`transcript_files`** is the incremental cursor.

```
path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime TEXT NOT NULL,
byte_offset INTEGER NOT NULL DEFAULT 0, last_uuid TEXT, updated_at TEXT NOT NULL
```

## 6. Attribution

For each record, normalise `cwd`, then match against `project_paths`: exact
match first, then longest matching prefix.

Normalising means, precisely: resolve to an absolute path, convert backslashes
to forward slashes, strip any trailing separator, and lowercase the result on
Windows only, because NTFS is case-insensitive while ext4 is not. Paths are
stored in `project_paths` already normalised, so matching is a plain string
comparison rather than filesystem access. This matters because a historical
`cwd` may name a directory that no longer exists, so attribution must never
depend on the path being resolvable on disk.

No match leaves `project_id` NULL. That spend is surfaced in the UI as
**Unattributed**, with the originating directory shown so the user can link it.

Linking is always a user action. The system may *suggest* a link when a
directory's basename equals a project's name, but never applies one silently.
Attributing money to the wrong project is worse than admitting it is
unattributed, and a silent wrong attribution is unfalsifiable from the UI.

`cost_entries.project_id` is already nullable, so no schema change is needed for
the unattributed case.

## 7. Sync

Three triggers:

1. **Startup.** A background scan kicked off after `listen`, never blocking it.
   This mirrors the existing `backfillMilestoneDailyStats` call in
   `server/index.ts`.
2. **Periodic.** Every 60 seconds, `stat` known files and process only those
   whose size or mtime has moved.
3. **Manual.** `POST /api/ingest/scan`.

Reading resumes from `byte_offset`, so steady-state cost is proportional to new
bytes, not to the 1,093 files on disk. If a file is smaller than its recorded
size it is treated as rotated or rewritten, and re-read from zero. Idempotency
makes that safe rather than duplicating rows.

Idempotency is enforced at the database, not in application logic:
`external_id` is the record `uuid`, and inserts use `INSERT OR IGNORE` against
the partial unique index. Application-level de-duplication would be one bug away
from double counting.

## 8. Pricing

A static table in `pricing.ts`, keyed by model identifier, with separate rates
for input, output, cache write and cache read.

Static rather than fetched. A local-first tool that needs a network call to tell
you what you spent has given up the property that makes it local-first, and a
pricing endpoint is a dependency that can fail, rate-limit, or disappear.

**An unknown model stores its tokens with `cost_usd` NULL and is surfaced as
"unpriced".** It is never silently costed at zero, which would understate spend
and quietly corrupt the total the whole design exists to make trustworthy. The
count of unpriced records is part of `GET /api/ingest/status`, so the condition
is visible rather than inferred.

Rates must come from the `claude-api` skill at implementation time. They are not
to be recalled from memory or estimated.

## 9. Error handling

The governing rule is that ingestion is best-effort and never degrades the
running server.

| Condition | Behaviour |
|---|---|
| Malformed JSON line | Skip, increment a counter, continue the file |
| Record with no `message.usage` | Skip silently; most records legitimately lack it |
| Unreadable file | Skip the file, log at warn, continue the scan |
| Claude home absent | No-op. Not an error, and not a warning on every tick |
| Unknown model | Ingest with `cost_usd` NULL, count as unpriced |
| Any sync failure | Logged, never propagated into server startup or a request path |

`SyncResult` carries counts for records ingested, skipped, unpriced and
unattributed. Those counts are the contract that makes the behaviours above
observable rather than invisible.

## 10. Testing

Integration tests against a real in-memory database, no mocking, matching the
repository's existing convention. Fixtures are small JSONL files under
`tests/fixtures/transcripts/`, with `VIBE_DASH_CLAUDE_HOME` pointed at them.

The load-bearing test is **sync, sync again, assert the second run inserts
nothing and totals are unchanged**. Idempotency is the property the money
figures rest on, so it gets a dedicated test rather than being assumed.

Also covered:

- Append to a fixture, re-sync, assert only the new records land, proving the
  byte-offset cursor.
- Truncate a fixture, re-sync, assert re-read from zero produces no duplicates.
- Malformed lines, records without `usage`, and `isSidechain` subagent records.
- Pricing for a known model, and an unknown model yielding NULL cost plus an
  unpriced count.
- Attribution: exact match, prefix match, and no match leaving `project_id` NULL.

## 11. Documentation and canon changes

These are part of the work, not follow-ups. Shipping the feature while the
documentation argues against it is how the plugin subsystem survived for months
after the README declared it removed.

1. **README.md**: delete the "Passive cross-platform ingestion (webhooks, log
   scraping)" bullet from *What Vibe Dash is not*. Reading transcripts is log
   scraping, and that bullet would directly contradict the product.
2. **README.md**: revise the cost bullet again. PR #172 corrected it from
   "logged automatically" to "recorded when an agent calls `log_cost`". With
   this feature that becomes wrong in the other direction for Claude Code.
3. **New decision doc** superseding `2026-05-strategic-positioning.md`, recording
   D1 with its rationale, and marking the old file superseded rather than
   deleting it.
4. **`~/.claude/context/strategy.md`**: update the vibe-dash portfolio row.
5. **Memory graph**: a `feedback` or `project` entity recording D1 and D2,
   linked to the `vibe-dash` entity via `belongs-to`.
6. **New `docs/ingestion.md`**: what is read, what is derived, what is inferred,
   and the limits. A feature that claims trustworthiness owes the reader a
   precise account of what it does and does not know.
7. **Integration guides**: stop instructing Claude Code agents to call
   `log_cost`. Leave that instruction in place for the other agents.

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Transcript format changes without notice | High | Parsing is tolerant by construction: unknown fields ignored, bad lines skipped and counted. A format break degrades to zero new records, not corruption. The skipped-line count in `/api/ingest/status` is the early warning. |
| Price table goes stale | Medium | Unknown models are unpriced rather than mispriced. Staleness in a *known* model's rate is the residual risk and is not detectable from inside the tool; the table needs a review date and an owner. |
| Claude Code only, while the README sells five agents | Medium | Documented plainly in `docs/ingestion.md`. `log_cost` continues to serve the others, so no agent loses a capability. |
| 1,093 files on first run is slow | Low | Backfill is backgrounded and offset-tracked, so it is a one-time cost that never blocks startup. Measure before optimising. |
| Reading transcripts is a privacy surface | Medium | Only `usage`, `model`, `cwd`, `sessionId`, `uuid`, `timestamp` and `gitBranch` are extracted. Prompt and response content is never read into the database. This must stay true and belongs in `docs/ingestion.md`. |

## 13. Success criteria

1. A fresh `npm start` on a machine with Claude Code history shows real
   per-project spend with no configuration.
2. Running the scan twice does not change any total.
3. Spend from a directory not linked to a project appears as Unattributed with
   its path shown.
4. An unknown model appears as unpriced, not as zero cost.
5. No document in the repository contradicts the feature's existence.
