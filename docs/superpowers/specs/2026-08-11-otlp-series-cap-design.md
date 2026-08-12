# Bounding the OTLP series table

**Status:** Design approved, not yet planned
**Date:** 2026-08-11
**Follows:** [2026-08-10-otlp-cost-receiver-design.md](2026-08-10-otlp-cost-receiver-design.md), shipped in #187

## 1. Context

`otlp_series` records the last value seen for each cumulative OTLP metric
series, so an export carrying a running total contributes only its increase.
The security review of #187 found nothing bounds it:

> `seriesKey` hashes `[metricName, scopeName, resourceAttributes, attributes]`
> verbatim, and both are attacker-supplied strings with no restriction on
> additional keys. No code path ever deletes a row.

Any local process can therefore mint unbounded rows by varying one attribute
per payload. The endpoint is unauthenticated by design, consistent with the
rest of this local API, so "a local process" is a low bar.

### 1.1 This is abuse resistance, not retention

Worth separating, because the two want different mechanisms and the wrong one
is actively dangerous.

For a legitimate sender the table converges and stops. Codex emits four token
types across a model or two, so a real user reaches perhaps a dozen rows and
never grows again. There is no natural accumulation to reclaim.

Unbounded growth happens only when a sender varies its attributes per payload,
which is either a flood or a misconfiguration. So the problem is admitting too
many NEW series, not holding old ones too long.

## 2. Decisions

### D1. Cap creation. Never delete.

A point that would create a NEW series is refused once `otlp_series` already
holds `SERIES_CAP` rows or more, so the table never exceeds the cap. Every
existing series continues to work exactly as before, regardless of how full the
table is.

Stated as a comparison to remove any doubt: create when `count < SERIES_CAP`,
refuse when `count >= SERIES_CAP`.

**Rejected: pruning rows idle for some window.** This is the obvious answer and
it is unsafe here. `seriesIncrement` treats an absent row as never-seen and
records the point's FULL cumulative value. Delete a live sender's row and its
next export re-records its entire running total as new spend, silently
double counting everything it ever reported. The exposure falls on exactly the
senders most likely to be legitimate: long-lived ones that go quiet and resume.

Pruning also does not solve the stated problem. A flooder mints new keys faster
than any window reclaims old ones.

**Rejected: evicting the least recently updated to make room.** Same defect as
pruning, reached by a different route, and it evicts under precisely the load
that makes eviction most likely to hit a live series.

Never deleting is what makes the double-count trap structurally unreachable
rather than merely unlikely. A row that exists is never mistaken for a row that
does not.

### D2. The ceiling is 10,000, and it is a constant

A legitimate user reaches perhaps a dozen rows. Ten thousand distinct attribute
combinations is not a configuration, it is a flood.

The bound holds against the traffic the endpoint permits: a 1mb body carries
roughly 5,000 points, so at the route's 120 requests per minute a flooder
reaches the ceiling within seconds, after which every new key is refused.

**Rejected: making it configurable.** Nothing indicates a real user near the
ceiling, and a setting invites tuning a number nobody should need to think
about. A named constant carrying its reasoning is clearer, and can become a
setting the first time someone genuinely hits it.

### D3. Delta senders are unaffected, by construction

`resolveQuantity` returns a delta point's value directly and never calls
`seriesIncrement`. A delta point describes an interval and needs no state, so
it neither creates a series nor consults the cap. Nothing in this design can
refuse one.

This is worth stating because it halves the blast radius: only cumulative
senders can be affected at all.

### D4. A refused point is lost spend, so it is never silent

This project treats losing spend as exactly as bad as double counting. A
refused point writes no row, so it must be visible somewhere, or a flooded
install would quietly under-report a legitimate sender caught behind the cap.

`GET /api/ingest/status` gains two fields:

- `otlpSeriesCount`, a real query against `otlp_series`, so it is durable and
  tells an operator how close the install is to the ceiling.
- `otlpSeriesRefused`, the count of points refused because the ceiling was
  reached.

The second is process-lifetime and resets on restart, for the same reason
`otlpUnmapped` already is: a refused point leaves nothing in any table to count
later. That limitation is stated in its comment rather than left to be
discovered, as it already is for `otlpUnmapped`.

## 3. Goals and non-goals

**Goals**

1. A local process cannot grow `otlp_series` without bound.
2. A sender whose series already exists keeps recording correctly, whatever the
   table size.
3. A refused point is counted and visible, never silently dropped.

**Non-goals**

Retention or pruning of any kind. Deleting cost rows. Configurability.
Authenticating the endpoint, which remains out of scope for the same reason it
was in #187: the whole local API is unauthenticated and singling out one route
would be theatre.

## 4. The change

### 4.1 `seriesIncrement` gains a refusal

Signature becomes:

```ts
export function seriesIncrement(
  db: Database.Database,
  key: string,
  startTimeNano: string,
  timeUnixNano: string,
  value: number
): number | null
```

`null` means "refused: the ceiling is reached and this series does not exist".
It is distinct from `0`, which means "this series exists and has not moved".
The two must not be conflated: the first is spend we could not record, the
second is no spend to record.

The count is consulted ONLY on the branch where `previous === undefined`, so
the cost is one `COUNT(*)` per genuinely new series rather than per point. An
established sender never pays it.

### 4.2 The caller must not lean on coercion

`resolveQuantity` currently returns `number` and its caller reads:

```ts
const quantity = resolveQuantity(db, point);
if (quantity <= 0) continue;
```

In JavaScript `null <= 0` evaluates to **true**, because `null` coerces to `0`.
So a `null` return would be swallowed by the existing guard and behave
correctly by accident, while counting nothing and telling nobody.

The check therefore becomes explicit:

```ts
const quantity = resolveQuantity(db, point);
if (quantity === null) { refusedPoints++; continue; }
if (quantity <= 0) continue;
```

This is called out because the accidental behaviour is the dangerous kind: it
works, so nothing fails, and the visibility this design exists to provide is
quietly absent.

### 4.3 No migration

`otlp_series` is unchanged. The cap is a read of its size, not a new column.

## 5. Error handling

| Condition | Behaviour |
|---|---|
| New series, table under the ceiling | Row created, increment returned as today |
| New series, ceiling reached | Point refused, counted, no row created, no cost row written |
| Existing series, any table size | Unaffected, increment returned as today |
| Delta point, any table size | Unaffected, never reaches the cap |

A refusal is not an error to the sender. The response stays `200`: the payload
was well formed and the rest of it may have been recorded, and a `4xx` would
tell a well-behaved exporter to stop retrying data we might accept later once
an operator intervenes.

## 6. Testing

- A new series is created normally while the table is under the ceiling.
- At the ceiling, a point for a NEW series is refused, writes no cost row, and
  increments the refused counter.
- At the ceiling, a point for an EXISTING series still records its increment.
  This is the property that makes the design safe and it gets its own test.
- A delta point is recorded at the ceiling, proving the cap cannot touch it.
- `null` is distinguished from `0`: a refused point and an unmoved series both
  write no row, but only the first is counted as refused.
- `otlpSeriesCount` reflects the real table size.

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| A legitimate sender genuinely needs more than 10,000 series and is silently under-reported | Low | `otlpSeriesRefused` makes it visible, and the ceiling can become a setting the first time it is hit in anger |
| An operator never looks at the status endpoint and misses a flood | Medium | Real, and shared with every other counter there. Surfacing these on the dashboard is the same deferred follow-up |
| The `COUNT(*)` becomes hot under a flood | Low | It runs only when a series does not exist, and a flood reaches the ceiling within seconds, after which the count still runs but the work per point is trivial |

## 8. Success criteria

1. A process posting unique attribute values cannot grow `otlp_series` past the
   ceiling.
2. With the table at the ceiling, an established cumulative sender's figures are
   unchanged.
3. A refused point appears in `otlpSeriesRefused` and nowhere in `cost_entries`.
4. No cumulative series ever loses its stored state, so no sender can have its
   running total re-recorded as new spend.
