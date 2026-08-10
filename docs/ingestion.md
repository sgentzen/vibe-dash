# Transcript ingestion

Vibe Dash reads Claude Code's own session transcripts off disk and turns them
into cost and token figures. This exists because every other number on the
dashboard arrives only when an agent chooses to call an MCP tool, and nothing
verifies that it did. Transcript ingestion is correct whether or not an agent
remembered to report anything.

A feature that claims to be trustworthy owes you a precise account of what it
does and does not know. That is what this page is.

## What is read

Vibe Dash scans `~/.claude/projects/**/*.jsonl` recursively, including the
nested `subagents/` directories Claude Code uses for sidechain sessions. Set
`VIBE_DASH_CLAUDE_HOME` to point somewhere else, or at an empty directory to
switch ingestion off entirely. See the configuration table in the
[README](../README.md#configuration).

From each transcript record, only these fields are read:

- `usage`: the token counts (input, output, cache read, cache write)
- `model`: which model produced the turn
- `cwd`: the working directory the session ran in, used for project attribution
- `sessionId` and `uuid`: identifiers, the latter doubling as the idempotency key
- `timestamp`: when the turn happened
- `gitBranch`: the branch checked out at the time
- `isSidechain`: whether the turn was a subagent call

**Prompt and response content is never read into the database.** Nothing about
what you asked Claude Code to do, or what it said back, is parsed, stored, or
sent anywhere. The scan reads a JSON line, pulls the eight fields above out of
it, and discards the rest.

Scanning happens automatically, once at server startup and every 60 seconds
after that, alongside the same `POST /api/ingest/scan` endpoint you can call by
hand. A run only reads the bytes appended since its last pass, tracked per file
by a byte offset, and a cursor never advances past a line that has not been
fully written yet. Re-scanning never changes a total: ingestion is idempotent,
keyed on each record's `uuid`.

## What is derived

Cost in USD is computed from a static rate table in
[`server/ingest/transcripts/pricing.ts`](../server/ingest/transcripts/pricing.ts),
not fetched over the network. A local-first tool that needs a network call to
tell you what you spent has given up the property that makes it local-first.
The table carries a review date so a human checks it each quarter as Anthropic
publishes rate changes; nothing in the code can detect a stale rate on its own.

**Known limitation:** Claude Sonnet 5 has introductory pricing of $2/$10 per
million input/output tokens through 2026-08-31, after which the rate is
$3/$15. Vibe Dash uses the standard $3/$15 rate throughout, so Sonnet 5 spend
inside the introductory window is **overstated**. This was a deliberate
choice: overstating spend is the safer direction, and adding date-dependent
rates would introduce a second class of bug in the money path.

An unknown model, one not in the rate table, is stored **unpriced**: its
tokens are still recorded, but its cost is SQL `NULL`, never zero. Zero would
mean "free" and quietly understate your spend. `GET /api/ingest/status`
reports how many rows are unpriced, and `knownModels` in that same response
lists every model the table can currently price.

## What is inferred, and how conservatively

Spend is attributed to a project only by an explicit directory link, created
with `POST /api/ingest/paths`. Nothing is inferred automatically and nothing
is auto-linked, even when a `cwd` obviously matches a project you already
have.

Spend from a directory with no link keeps its `project_id` as `NULL` and is
counted separately, as `unattributed` in `GET /api/ingest/status`. The
originating directory itself is not currently stored anywhere or exposed by
any endpoint: the `cwd` on each transcript record is read only long enough to
look up a project, then discarded. So linking that spend means knowing the
directory yourself and calling `POST /api/ingest/paths` with it, not reading
it back off the dashboard. Nothing is guessed and nothing is dropped, but
matching an unattributed total back to the directory that produced it is on
you today.

## What it does not know

- **Which task the spend belongs to.** Transcripts carry a session and a
  working directory, not a task ID, so ingestion attributes spend to a
  project, never to a task within it.
- **Anything about agents other than Claude Code.** This whole pipeline reads
  Claude Code's transcript format specifically. Cursor, Codex, Aider, and any
  custom agent still report cost the way they always have, by calling the
  `log_cost` MCP tool.
- **When its own read of the format breaks.** The JSONL layout is undocumented
  and Anthropic can change it without notice. A line that cannot be parsed is
  skipped rather than crashing the scan, and each `POST /api/ingest/scan`
  response reports how many lines it skipped. A skipped count near zero is
  normal; a skipped count that keeps climbing is the early warning that the
  format has moved and this page's field list is now out of date.
