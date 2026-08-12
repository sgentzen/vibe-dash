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

Two consequences of an unpriced row are easy to miss. First, SQL `SUM`
skips `NULL`, so an unpriced row contributes nothing to a cost total while
still counting as an entry. Cost responses therefore carry an
`unpriced_entries` count beside their totals, and a total with a non-zero
count next to it is a floor, not the whole figure. The "Spend Today" number is
covered too: `GET /api/stats` still returns `spend_today` as the same bare
total it always has, and now carries a sibling field, `spend_today_unpriced`,
giving the count of today's unpriced rows beside it. The total itself has not
changed shape or value; only the count next to it is new. Second, an unpriced
row cannot be fully repriced later: input, output and cache-write tokens are
stored, but cache-read tokens are priced and then dropped, because
`cost_entries` has no column for them. Cache reads are usually the largest
token component of a Claude Code turn, so repricing a stored unpriced row
would understate it by most of its real cost. Persisting cache reads is
tracked as follow-up work.

## What the dashboard shows

These counts are not only API fields. Where a count qualifies a figure
already on screen, a small badge renders beside that figure, reading
`N unpriced`, `N unattributed`, or `N excluded`, with an explanation reachable
by hovering or focusing the badge, not only with a mouse, and dismissible with
Escape. Total Spend carries an unpriced badge, an excluded badge, and an
unattributed one. Spend Today carries an unpriced badge fed by
`spend_today_unpriced`. Cost by Model carries an unpriced badge per model, and
Cost by Agent carries both an unpriced badge and an excluded badge per agent.

The unattributed badge is the one exception to "beside the figure it
qualifies", and deliberately so. It combines `unattributed`, `otlpUnattributed`
and `mcpUnattributed`, which between them count every row with no project
across the three sources, install-wide. Such rows are not in a project-scoped
total and could not be, so selecting a project hides that badge rather than
letting it caveat a figure it says nothing about.

A badge is absent, not just faint, whenever its count is zero or missing, so
an install with nothing to caveat looks exactly as it did before these badges
existed.

Three counters describe data that was discarded before it became a figure at
all: `otlpUnmapped`, `otlpSeriesRefused`, and `otlpSeriesCount` once it
reaches the `otlpSeriesCap` alongside it, all covered in the OTLP section
below. There is no
total for these to sit beside, so they render instead as a short notice above
the cost cards, listing only the conditions that currently apply, and, like
the badges, it is absent entirely while none of the three has anything to
report.

Not every counter above reaches the screen. `GET /api/ingest/status` also
returns `filesTracked`, `transcriptRows`, `otlpRows`, and its own endpoint-wide
`unpriced`, with no badge, no notice, and no other home on the dashboard;
reading those still means calling the endpoint directly. The per-figure
unpriced badges come from the cost responses, not from that field.

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

`unattributed` counts transcript rows only. A row can arrive with no project
from any of the three sources, so `GET /api/ingest/status` reports the same
count for the other two: `otlpUnattributed` for OTLP, and `mcpUnattributed`
for spend an agent reported through `log_cost` without naming a project, which
`log_cost` permits. All three feed the one badge described above, because a
reader wants to know how much spend is tied to no project, not which pipe it
came down.

## What it does not know

- **Which task the spend belongs to.** Transcripts carry a session and a
  working directory, not a task ID, so ingestion attributes spend to a
  project, never to a task within it.
- **Which agent produced the spend.** Ingested rows are stored with no agent
  attached, and the Cost by Agent view filters those rows out. So transcript
  spend appears in per-project and per-model figures but never in per-agent
  ones, which will look like the two disagree if you are not expecting it.
  Only spend reported through `log_cost` names an agent.
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

## Cost from other runners, over OTLP

Transcript ingestion above reads Claude Code only. For every other runner,
Vibe Dash accepts OTLP/JSON metrics on the same server:

```
POST http://localhost:3001/v1/metrics
```

This is the standard OTLP/HTTP convention: an exporter appends `/v1/metrics`
to whatever endpoint it is given, so pointing a runner at
`http://localhost:3001` is the whole of its setup. No separate port and no
separate process.

### Setting up Codex

Add this to `~/.codex/config.toml`:

```toml
[otel]
metrics_exporter = "otlp-http"

[otel.exporter.otlp-http]
endpoint = "http://localhost:3001"
protocol = "json"
```

That is sufficient for Codex's token usage to reach the dashboard with no
`log_cost` call.

### Binding spend to a project

OTLP carries no working directory, so there is nothing here to match against
`project_paths` the way transcript ingestion does. A point is attributed only
when you set a resource attribute naming the project yourself:

```bash
OTEL_RESOURCE_ATTRIBUTES=vibe_dash.project=<name or id>
```

The value is matched against a project name first, then a project id. Without
this variable, spend is not dropped: it is still recorded, with `project_id`
`NULL`, and counted in `GET /api/ingest/status` as `otlpUnattributed`. Nothing
here is ever guessed from `service.name` or any other attribute.

### What this does not cover

**Interactive CLI only.** Codex only emits OTLP metrics from the interactive
CLI session. `codex exec` emits logs and traces but no metrics, and `codex
mcp-server` emits no telemetry at all, so a headless or MCP-driven run
produces nothing here regardless of `config.toml`. See
[openai/codex#12913](https://github.com/openai/codex/issues/12913).

**Not retroactive.** Unlike transcript ingestion, which can read a whole
history of past `.jsonl` files the first time it runs, nothing is recorded
for sessions that ran before the exporter was switched on. There is no
backfill.

**Claude Code is not read here.** This endpoint accepts OTLP from any sender,
but no mapper recognises Claude Code's metric names, so pointing a Claude
Code OTLP exporter at it records no cost rows and only increments the
unmapped count described below. Claude Code cost comes from transcripts, at
the top of this page, and having two sources report the same spend is
exactly the double-counting problem transcript ingestion was built to avoid.

**A runner sending OTLP must stop calling `log_cost`, or its spend doubles.**
This is the same hazard as the Claude Code one above, in a new place. OTLP
rows are stored with `source = 'otlp'` and `log_cost` rows with
`source = 'mcp'`, and nothing suppresses one because the other exists. A Codex
setup that both exports OTLP and follows the reporting instructions in
[docs/integrations/codex.md](integrations/codex.md) reports every turn twice,
and the total looks entirely plausible at roughly double the truth.

There are two ways out and you only need one. Remove the `log_cost` line from
your Codex instructions, which fixes future spend and leaves anything already
recorded doubled. Or mark the agent cost-observed with
`POST /api/agents/:id/cost-observed`, which also corrects the rows already
written, because the exclusion applies at query time rather than by deleting
anything. Marking excludes only `source = 'mcp'` rows, so the OTLP figures it
is meant to leave alone are never touched.

**Runners need a mapper.** Recognising a metric name and turning its points
into token counts is a small, per-runner piece of code. A runner Vibe Dash
has no mapper for has every point counted as unmapped and nothing else: no
row is written, and no error is raised, so a wrong or unsupported setup looks
identical to a correct one that simply has nowhere to report. Today the only
mapped runner is Codex.

**Only one Codex model is priced.** The rate table currently has one Codex
entry, `gpt-5.3-codex`. A Codex session on any other model still has its
tokens recorded, exactly as an unknown model already is for Claude Code, but
with `cost_usd` `NULL` rather than a figure: visibly unpriced, not free.
`GET /api/ingest/status`'s `knownModels` lists every model, across both
Claude and Codex, that the table can currently price.

**The unmapped count does not survive a restart.** `otlpUnmapped` on
`GET /api/ingest/status` is a count kept in the running server process, not a
database query, unlike `otlpRows` and `otlpUnattributed` beside it. Restarting
the server resets it to zero. It is useful for confirming, right now, that a
runner you just configured is or is not being recognised; it is not a
durable record of how much has gone unmapped over time.

**`otlp_series` never grows past 10,000 distinct series by creation.** Vibe Dash keeps a
running total for every distinct cumulative series it sees, so it can work out
how much of the next export is new. See `SERIES_CAP` in
[`server/ingest/otlp/series.ts`](../server/ingest/otlp/series.ts). Once the
table holds 10,000 rows, a point belonging to a series it has never seen
before is refused: no row is written for it, its tokens are not recorded, and
it is counted in `otlpSeriesRefused` on `GET /api/ingest/status`. The response
to the exporter still comes back `200`: the payload was well formed, and a
`4xx` would tell a well-behaved exporter to stop retrying data that might be
accepted later, once an operator has looked into it. Nothing about the table
grows that room back on its own; see below.

Stated as creation rather than as a size because the code refuses new rows and
never trims existing ones. An install that was flooded before this cap existed
arrives with however many rows it accumulated then, keeps all of them, and
refuses every new series from that point on. The guarantee below about
established senders still holds for it, but its table is larger than the
ceiling and will stay that way.

**A series the table already knows keeps recording normally, however full the
table is.** The cap only ever applies to a point that would create a brand new
row. A series that already has a row is never refused, never delayed, and
never affected by how close the table is to the ceiling, no matter how many
other rows have filled it up. This is the guarantee that matters most if
you're reading this after a flood: whatever else got refused, none of your
already-established senders lost any spend.

**Nothing is ever deleted from `otlp_series`.** A cumulative point's stored
row is how Vibe Dash knows how much of the next export is new spend; without
it, the point would be read as a series never seen before and its whole
running total recorded as if it were new. So no row is ever removed to make
room for another, and no sender's already-reported spend can be counted again
as new. This is also why the table never has room to give back: the ceiling,
once reached, holds until `SERIES_CAP` itself changes.

**If `otlpSeriesRefused` is climbing.** Compare `otlpSeriesCount` against
`otlpSeriesCap` in the same response to confirm the table is the reason. A
genuine install reaches perhaps a
dozen series, so a count near 10,000 almost always means something has been
sending varying attribute values rather than that you have outgrown the
ceiling. Find that sender first.

If you conclude you genuinely need more room, or you have been flooded and
want to admit new senders again, raise `VIBE_DASH_OTLP_SERIES_CAP` and
restart. It defaults to 10000, and a value that is not a positive integer is
ignored with a warning rather than accepted, because a cap of zero would
refuse every series on an install whose owner believed they had raised it.

Raising the ceiling is the only way to make room, since nothing is ever
deleted. That is deliberate, and it does mean a flood is not self-healing: an
install filled to the ceiling refuses every new series until someone raises
it.

Refused spend from a cumulative sender is deferred rather than lost. A
cumulative export carries the sender's running total, not just the latest
slice, so once room exists and its series is finally admitted, its next export
records the whole total including everything refused while it waited. Nothing
is recovered for a sender that stops before that happens, and nothing here
applies to delta senders, which never create a series row and so are never
refused in the first place.

**Delta points never reach the cap.** A delta point already describes an
interval on its own and needs no stored row to interpret the next one, so it
is recorded directly and never consults `otlp_series` at all. Only cumulative
senders can be affected by the cap.

**`otlpSeriesCount` on `GET /api/ingest/status` shows how close an install is
to the ceiling.** It is a real count of the `otlp_series` table, so, unlike
the counter below, it is durable and survives a restart. The same response
carries `otlpSeriesCap`, the ceiling the server is actually enforcing, so
nothing has to assume the number: the dashboard reads it rather than holding
its own copy, which would have kept announcing "at capacity" against a
ceiling that no longer applied the moment someone raised it.

**`otlpSeriesRefused` does not survive a restart.** Like `otlpUnmapped` above,
it is a count kept in the running server process, not a database query.
Restarting the server resets it to zero. It is useful for confirming, right
now, that a flood is or is not hitting the cap; it is not a durable record of
how much has been refused over time.

## Upgrading from an earlier version

**Remove the `log_cost` step from your Claude Code instructions, or your spend
will be counted twice.**

Before this feature, the way to get Claude Code cost onto the dashboard was to
tell the agent to call the `log_cost` MCP tool, and
[docs/integrations/claude-code.md](integrations/claude-code.md) said exactly
that. Any per-project `CLAUDE.md` you set up under those instructions still
carries that step, and upgrading Vibe Dash does not change files in your other
repositories.

If that instruction is still in place, a single Claude Code session now records
its cost twice: once when the agent calls `log_cost`, and again when the scan
reads the same turns out of the transcript. Every affected total is roughly
double, and nothing in the interface flags it.

Rows do carry a `source` column, `mcp` or `transcript`, so the two are
distinguishable and the damage is auditable after the fact.

**Mark the agent as cost-observed, which corrects every session of the same
client, past and future.** Call `POST /api/agents/:id/cost-observed` with
body `{ "observed": true }` for the Claude Code agent whose spend is
doubled. The mark is not stored against that one agent row: it is keyed to
the MCP client the agent connected as (`agents.client_name`, recorded when
the agent registered), and an agent's cost identity is
`COALESCE(client_name, name)`. Every cost query then excludes `source =
'mcp'` rows from any agent sharing that identity, so marking one Claude Code
session also covers every earlier and later session of that same client
without marking each one. Its `source = 'transcript'` rows keep counting,
since those are the real figure. The response names what it matched, as
`{ agent, identity, observed }`, so you can see which client is now covered.
`GET /api/ingest/status` lists the overlap that makes the affected client
easy to find before you mark it, under its `overlaps` array, where each entry
now carries `mcp_identities` alongside `mcp_agent_names`.

An overlap entry is grouped by project and day, not by identity, so marking
one identity does not necessarily make the entry disappear. If a
project-and-day entry lists two identities in `mcp_identities` and you mark
one, the entry stays, with a lower `mcp_entries` count and a shorter
`mcp_identities` list, because the identity you marked drops out of both
while the other identity's `mcp` rows are still there and still unmarked. A
row surviving with a reduced count and one fewer name in `mcp_identities` is
progress, not a sign the mark failed. An empty `mcp_identities` is what
confirms every identity on that project and day is covered.

An empty `mcp_identities` does not on its own mean the entry will disappear.
An entry whose `mcp` rows all carry no agent starts out with an empty list and
stays in the report permanently, because marking cannot reach those rows at
all. See "A row recorded with no agent attached" below.

**Agent rows written before this release predate `client_name` and get no
benefit from the above.** An agent row created by an earlier version of Vibe
Dash has no recorded client name, so its cost identity falls back to its own
full, connection-suffixed name (for example `claude-code-a1b2c3d4`), which is
unique to that one past session. Marking such a row covers only that session;
it does not reach any other past session of the same client, and it does not
generalise to future sessions the way marking a current agent does. If you
are upgrading with existing duplicates spread across many past sessions, you
need one mark per past agent row, found by listing agents and marking each
one whose spend looks doubled. There is no backfill for this: the only way to
backfill would be guessing which part of an old agent's name is the
connection suffix, and this feature is built specifically to never guess
about money.

**A row recorded with no agent attached can never be excluded by marking.**
The exclusion requires the row to name an agent, because a self-report that
named no agent cannot be resolved to any identity, marked or not. This
affects anyone whose earlier `log_cost` calls did not name an agent, which
older setups could do before this release started attaching the session
agent to `log_cost` automatically. Those rows stay double counted no matter
what you mark, and stay listed in `GET /api/ingest/status`'s `overlaps` array
indefinitely. There is no way to correct them through the interface today.
The signal that one of these rows is present: an `overlaps` entry's
`mcp_agent_names` list names fewer agents than `mcp_entries` would suggest,
because a self-report that named no agent is counted in `mcp_entries` but
never appears in `mcp_agent_names`. Reading that gap and deciding what it
means is left to you.

**Marking a client can also suppress a different agent's genuine spend, if
that agent happens to share the client's name.** Because identity is
`COALESCE(client_name, name)`, a self-named agent (one registered through
`register_agent` or `log_activity` rather than an MCP connection) whose own
name is identical to a client name you have marked is treated as the same
identity. Its `mcp` rows are then excluded too, even though they are not
duplicates of anything, so real spend disappears from totals rather than
being counted twice. This is a consequence of keying the mark to a shared
identity rather than to one row, and it will not fix itself. To avoid it,
do not name a self-reporting agent after a client you have already marked
as cost-observed.

If you hit it, unmarking (`{ "observed": false }`) is only a stop-gap, not
the fix. The mark is keyed to the identity string, not to either agent, so
unmarking restores the wrongly suppressed agent's spend and, at the same
time, stops excluding the marked client's own `mcp` rows, which brings back
the double counting the mark existed to remove for that client. Unmarking
trades one wrong total for the other rather than fixing either.

Renaming the self-reporting agent so its name no longer matches the marked
client's name, then marking the client again, only fixes this going forward.
`registerAgent` upserts on the normalised name, so a new name is a new agent
row, not a change to the old one, and there is no rename endpoint that would
alter the old row instead. Every `mcp` row already recorded still points at
that old agent row, whose name (and therefore whose identity, since a
self-named agent has no `client_name`) is still the colliding value. Marking
the client again after the rename excludes the old row's historical rows
exactly as before, and it is easy to believe the problem is now fixed when
only new spend under the new name is behaving correctly.

There is no way to correct those already-suppressed historical rows through
the interface today, the same as the two no-backfill limitations above. A
user who has already accumulated them chooses between leaving the client
unmarked, which counts that historical spend correctly but resumes double
counting for the client, and marking the client, which fixes the double
counting but keeps the old agent's historical spend suppressed.

**Nothing is deleted.** Marking a client only changes which rows a query
counts; the excluded `mcp` rows stay in the database, so unmarking
(`{ "observed": false }`) restores the previous totals exactly. Marking is
also never automatic: nothing in Vibe Dash infers that an agent is Claude
Code, so a duplicate stays visible until you mark it yourself.

Leave the `log_cost` step in place for every other agent. Cursor, Codex, Aider
and anything custom are not read from transcripts, so for them it remains the
only way spend is recorded at all.
