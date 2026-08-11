# Collecting cost from other runners over OTLP

**Status:** Design approved, not yet planned
**Date:** 2026-08-10
**Follows:** [2026-08-09-transcript-ingestion-design.md](2026-08-09-transcript-ingestion-design.md) and
[2026-08-10-observed-cost-exclusion-design.md](2026-08-10-observed-cost-exclusion-design.md)
**Positioning:** [docs/decisions/2026-08-09-used-oss-project.md](../../decisions/2026-08-09-used-oss-project.md), D2

## 1. Context

The locked wedge is trustworthy cost data alongside any runner. Transcript
ingestion delivered that for Claude Code by reading `~/.claude/projects` with no
configuration and no agent cooperation. It reads nothing else. A user on Codex,
Cursor or Gemini CLI gets only what their agent chooses to self-report through
`log_cost`, which is the trust problem the wedge exists to escape.

### 1.1 This is a growth bet, and nothing here improves the current numbers

Every cost row in the developer's own database is Anthropic:

```
anthropic / claude-sonnet-4-6  (99)      anthropic / claude-opus-4-8   (16)
anthropic / claude-opus-4-7    (22)      anthropic / claude-haiku-4-5   (4)
anthropic / claude-sonnet-4-5  (17)      anthropic / claude-fable-5     (1)
```

No non-Claude runner has ever produced data here. This feature therefore ships
with no user whose figures improve, and its value rests entirely on an adopter
arriving with a different runner. That is a legitimate call under the used-OSS
positioning, which made adoption arguments count for the first time, but it
should be recorded as the bet it is rather than dressed up as a correctness fix.

The consequence for scope: prefer the smallest thing that is genuinely correct
for a second runner over a broad OTLP implementation whose extra surface nobody
is yet exercising.

## 2. Decisions

### D1. OTLP, not hooks

The transcript-ingestion spec listed Claude Code hooks and an OTLP receiver as
equal follow-ups. For this goal they are not equal: hooks are Claude Code only,
so they contribute nothing to multi-runner coverage. That spec already said as
much of OTLP, calling it "the only one with a story for non-Claude tools".

Hooks remain a reasonable future route to a live edge for Claude Code. They are
simply not this.

**One rejection reason is void.** That spec also rejected OTLP for needing "a
protobuf endpoint in the server". It does not. Claude Code accepts
`OTEL_EXPORTER_OTLP_PROTOCOL` of `grpc`, `http/protobuf` or `http/json`, and
Codex's `[otel.exporter.otlp-http]` accepts `protocol = "binary"` or `"json"`.
JSON is sufficient for both.

### D2. Non-Claude runners only. Claude Code stays on transcripts.

The receiver maps runners that transcripts cannot reach. It does not map
`claude_code.*` metrics, even though it would receive them if pointed at us.

The immediately preceding branch spent seven tasks and four fix rounds undoing a
double count between two sources for the same spend. A third source aimed at
Claude Code would recreate that risk on top of a precedence rule
(`transcript` wins) that has never been exercised against three sources. Refusing
to map `claude_code.*` removes the possibility entirely rather than managing it.

**Rejected:** mapping Claude Code's OTLP for its richer attribution. Its
`claude_code.token.usage` carries `speed: "fast"`, `effort`, and `query_source`
(`main`, `subagent`, `auxiliary`), which transcripts cannot supply and which
would close a real gap in the pricing table around fast mode. Genuinely
valuable, and it belongs in a later design that takes the three-source
precedence problem seriously rather than smuggling it in here.

### D3. JSON only. No protobuf, no gRPC, no logs signal.

One endpoint, `POST /v1/metrics`, accepting OTLP/JSON. The codebase parses JSONL
with `JSON.parse` and has no wire-format dependency; this keeps it that way.

**Rejected:** protobuf and gRPC. Both runners support JSON, so the dependency
buys compatibility nobody in scope needs.

**Rejected:** the logs signal. Codex also emits `codex.sse_event` log records
carrying token fields, so logs are a second possible route to the same numbers.
Two routes to one figure is how double counting starts. Metrics only.

### D4. The payload declares its temporality. Never assume it.

This is the correctness core of the feature.

OTLP Sum and Histogram points carry an `aggregationTemporality` field. Delta
points describe an interval; cumulative points describe a running total since
`startTimeUnixNano`. Recording a cumulative point as though it were delta
multiplies reported spend by the number of exports, with nothing failing and no
error surfacing.

This is not hypothetical. Claude Code defaults to delta, and users routinely set
`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` because Mimir and
VictoriaMetrics reject or drop delta counters. Codex's default is unverified.

So the receiver reads the field:

- **Delta**: the point's value is new spend. Record it.
- **Cumulative**: the new spend is the increase since the last point for that
  series. Record the difference.

What gets written for a cumulative point is the **increment**, not the point's
value: the row's token counts are the difference, and its cost is priced from
that difference. For a histogram the tracked quantity is the point's `sum`,
which is itself cumulative, so the same subtraction applies to it.

**Rejected:** accepting delta only and refusing cumulative. Simpler and safe
against inflation, but it discards real spend from any correctly configured
sender, and losing spend is treated here as exactly as bad as double counting.

**Rejected:** a configuration option declaring which temporality to expect. The
protocol already states it per point. A setting could only ever contradict the
data.

### D5. Attribution is never guessed

OTLP carries no working directory. Transcript ingestion attributes spend by
matching a record's `cwd` against `project_paths`; there is no equivalent field
here, and none of Codex's attributes (`auth_mode`, `originator`,
`session_source`, `model`, `app.version`) identifies a project.

A point therefore lands **Unattributed** unless the user opts in by setting a
resource attribute:

```
OTEL_RESOURCE_ATTRIBUTES=vibe_dash.project=my-project
```

The receiver matches that value against a project name, then a project id, and
falls back to `project_id NULL` when neither matches. This is the third member
of the same family as an unmatched transcript directory and an unknown model: a
visible unresolved state, never a guess.

**Rejected:** rejecting points that name no project. It keeps the table tidy by
discarding real spend.

**Rejected:** inferring a project from `service.name`. That names the agent, not
the work.

### D6. The receiver is generic; each runner gets a mapper

Metric names are vendor-prefixed. Claude Code emits `claude_code.token.usage`;
Codex emits `codex.turn.token_usage`. The GenAI semantic conventions standardise
attributes such as `gen_ai.*`, not metric names, so there is no single metric to
read.

The endpoint, temporality handling, series state and idempotency are therefore
runner-agnostic and live in one place. Recognising a metric name and turning its
points into token counts lives in a per-runner mapper. Adding a runner is a new
mapper and its tests, not surgery on the endpoint.

The honest form of the wedge is "any runner we have a mapper for, and a mapper
is small", not "any runner". Documentation must say the former.

## 3. Goals and non-goals

**Goals**

1. A Codex user's token usage reaches the same tables and the same dashboard as
   a Claude Code user's, without their agent calling `log_cost`.
2. A cumulative sender and a delta sender both produce the same, correct totals.
3. Adding a second runner is demonstrably small.

**Non-goals**

Claude Code over OTLP. Traces and logs. gRPC and protobuf. Retrofitting cost to
sessions that ran before the exporter was switched on: unlike transcripts, OTLP
is not retroactive, and that difference is stated in the documentation rather
than worked around.

## 4. The endpoint

```
POST /v1/metrics        Content-Type: application/json
```

Mounted on the existing Express server rather than a separate listener, so a
user points their runner at `http://localhost:3001`. The OTLP/HTTP convention is
that the exporter appends `/v1/metrics` to the configured endpoint, so no path
configuration is needed on their side.

Responses follow the OTLP/HTTP contract, because exporters act on the status
code: `200` with an `ExportMetricsServiceResponse` body on success, `400` for a
malformed body, `429` when rate limited. A retryable status makes a well-behaved
exporter resend, which is why §5.2 must make ingestion idempotent.

Rate limited like the other mutation routes, and the JSON body size is capped.
An unauthenticated local endpoint that writes to the cost table is the widest
new surface this feature adds; the cap and the limiter are what bound it. The
server already binds to `127.0.0.1` in `docker-compose.yml`.

## 5. Data model

### 5.1 Source tagging

`cost_entries.source` gains a third value, `otlp`, beside `mcp` and
`transcript`. No precedence rule changes, because D2 guarantees `otlp` and
`transcript` never describe the same spend.

### 5.2 Idempotency, enforced by the database

The recorded invariant from transcript ingestion is that idempotency is enforced
by the database and never by application logic. The partial unique index on
`cost_entries.external_id` already exists for that purpose, and this feature
reuses it rather than adding a mechanism:

```
external_id = 'otlp:' || series_key || ':' || time_unix_nano
```

`series_key` is a stable hash of the resource attributes, the scope, the metric
name and the point attributes. It deliberately **excludes** `startTimeUnixNano`:
that field is what identifies a restart, so folding it into the key would make
every restarted series look like a brand new one and defeat the reset detection
in §5.3.

Two identical exports, whether from a network retry or a duplicate send, produce
identical `external_id` values, and `INSERT OR IGNORE` discards the second.

### 5.3 Series state, migration 022

Cumulative points need the previous value to compute an increase:

```sql
CREATE TABLE otlp_series (
  series_key      TEXT PRIMARY KEY NOT NULL,
  start_time_nano TEXT NOT NULL,
  last_value      REAL NOT NULL,
  updated_at      TEXT NOT NULL
);
```

This is the same shape and the same purpose as `transcript_files`: a record of
what has already been counted, so re-reading a source does not recount it.

**Reset handling.** A process restart begins a new series at zero. A reset is
detected when `startTimeUnixNano` differs from the stored value, or when the new
value is lower than `last_value`. On reset the full new value is recorded as new
spend and the row is replaced. Treating a reset as a negative delta would
subtract spend that was genuinely incurred.

## 6. The Codex mapper

Codex emits `codex.turn.token_usage` as a **histogram**, with `token_type` in
`input`, `cached_input`, `output`, `reasoning_output`, `total`, and default tags
`auth_mode`, `originator`, `session_source`, `model`, `app.version`.

- The token count is the histogram point's `sum`, not its `count`, which is the
  number of recorded turns.
- **`token_type = "total"` is skipped.** It is the sum of the others, and
  recording it alongside them doubles every figure. This gets an explicit test.
- `input` and `output` map to the existing columns. `cached_input` maps to cache
  reads. `reasoning_output` is billed as output by OpenAI and is added to the
  output count, with a comment recording that this is a pricing judgement rather
  than a name coincidence.
- `model` comes from the point attributes.

### 6.1 Pricing, and the honest limit

The pricing table holds Anthropic models. Codex runs OpenAI models, so under the
existing rule an unknown model stores tokens with `cost_usd NULL` and counts
toward `unpriced_entries`.

Shipping only that would mean a Codex user sees token counts and no cost, which
does not deliver the stated goal. So this work adds the current OpenAI Codex
model prices to the same table, using the same structure and the same fallback:
a model that is not listed remains unpriced rather than being priced at zero.

The staleness risk is real and is inherited, not introduced: the table already
carries a documented known limitation about introductory pricing. The
documentation gains a line stating that OpenAI prices are recorded as at the
date of this change.

### 6.2 What the mapper does not cover

`codex exec` emits logs and traces but no metrics, and `codex mcp-server` emits
no telemetry at all
([openai/codex#12913](https://github.com/openai/codex/issues/12913)). Only the
interactive CLI is covered. For a dashboard whose subject is automated agent
runs, that is a substantial gap and it belongs in the documentation next to the
setup instructions, not in a footnote.

## 7. Visible unresolved states

Consistent with how ingestion already treats what it cannot resolve, the
`GET /api/ingest/status` payload gains counts rather than silence:

- `otlpUnmapped`: metric points received whose metric name matches no mapper.
  This is what tells a user their runner is sending data that we are ignoring,
  which otherwise looks identical to sending nothing.
- `otlpUnattributed`: points recorded with no project.

Unpriced points are already covered by the existing `unpriced` counter.

## 8. Error handling

| Condition | Behaviour |
|---|---|
| Malformed JSON body (not object-shaped OTLP) | `400`, nothing recorded |
| Any other ingest failure (e.g. a transient DB error) | `503`, nothing recorded |
| Body over the size cap | `413`, nothing recorded |
| Unknown metric name | Point ignored, `otlpUnmapped` incremented, `200` |
| `claude_code.*` metric | Point ignored and counted as unmapped, per D2 |
| Unknown model | Recorded with `cost_usd NULL`, per the existing rule |
| No project attribute | Recorded with `project_id NULL` |
| Cumulative point, series unseen | Full value recorded, series row created |
| Cumulative point, value decreased | Reset: full value recorded, row replaced |
| Duplicate export | Discarded by the unique index on `external_id` |

A malformed payload never partially applies: parsing and mapping complete before
anything is written, and the writes run in one transaction.

`400` and `503` mean opposite things to an exporter and must not share a catch:
`400` says the body will never parse, whatever is sent again, so the exporter
must not retry it; `503` says the fault is ours and a retry is expected to
succeed. Only a body `parseMetricsPayload` refuses outright (thrown as
`MalformedOtlpPayloadError`, `server/ingest/otlp/parse.ts`) is `400`. Every
other failure raised while ingesting an otherwise well-formed payload is
`503` — retryable, and safely so, because `external_id` idempotency makes a
retried export a no-op rather than a double count. This project treats losing
spend (a wrongly-permanent `400`) as exactly as bad as double counting it, so
the distinction is made on error type, not on message text, which would break
silently the first time the message is reworded.

## 9. Testing

- A delta export records exactly its value; the same export replayed records
  nothing further.
- A cumulative series across three exports records the increments, not the
  running totals. This is the test that would have caught the inflation bug.
- A cumulative series that restarts at zero records the new value rather than a
  negative delta.
- `token_type = "total"` is skipped, proven by a payload containing it alongside
  the components and asserting the recorded total excludes it.
- A `claude_code.*` payload records no cost rows and increments `otlpUnmapped`.
- A point with no project attribute lands with `project_id NULL` and is counted.
- A point naming a project by name attributes to it; by id likewise.
- An unknown model records tokens with `cost_usd NULL`.
- A malformed body returns 400 and writes nothing.

## 10. Documentation

- A new section in `docs/ingestion.md` covering the Codex setup snippet, the
  `vibe_dash.project` attribute, and, plainly, the two limits: interactive CLI
  only, and no retroactive data.
- `README.md` gains OTLP beside transcript ingestion in the cost description,
  worded as "runners with a mapper" rather than "any runner".

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A cumulative sender inflates spend | High | The temporality field is read per point, and the increment test is the feature's central test |
| An adopter's runner is unmapped and they see nothing | Medium | `otlpUnmapped` makes it visible rather than silent |
| OpenAI prices go stale | Medium | Same exposure the table already carries; unknown models stay unpriced rather than wrong |
| Nobody ever uses it | Medium | Accepted in §1.1. The bet is explicit and the scope is deliberately small |
| An unauthenticated local endpoint writes to the cost table | Low | Rate limited, body capped, bound to localhost |

## 12. Success criteria

1. A Codex CLI configured with a short `config.toml` block produces cost rows
   that appear on the dashboard, with no `log_cost` call.
2. The same session exported cumulatively and exported delta produce identical
   totals.
3. Replaying any export changes no total.
4. A Claude Code exporter pointed at the endpoint produces no cost rows and a
   visible unmapped count.
5. Adding a second runner mapper touches one new file and its test, and no part
   of the receiver.
