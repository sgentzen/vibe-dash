# Showing where a cost figure is incomplete

**Status:** Design approved, not yet planned
**Date:** 2026-08-12
**Follows:** [2026-08-10-otlp-cost-receiver-design.md](2026-08-10-otlp-cost-receiver-design.md) and
[2026-08-11-otlp-series-cap-design.md](2026-08-11-otlp-series-cap-design.md)

## 1. Context

Three branches have gone into making these numbers trustworthy, and each added
a counter saying when a figure is not the whole truth: `unpriced_entries`,
`unattributed`, `excluded_entries`, `otlpUnmapped`, `otlpUnattributed`,
`otlpSeriesRefused`, `otlpSeriesCount`.

`src/` consumes exactly one of them. `excluded_entries` renders as a `+N
excluded` badge on the Cost by Agent card. Every other signal stops at the API.

Nothing in `src/` fetches `GET /api/ingest/status` at all, so five of those
counters have no route to the screen even in principle.

### 1.1 What that costs

A dashboard whose positioning is trustworthy numbers currently shows a total
that may be a floor, with nothing saying so. Two concrete cases:

- An unknown model stores its tokens with `cost_usd NULL`, never zero, and SQL
  `SUM` skips NULL. So the total silently understates and the entry still
  counts. `unpriced_entries` exists precisely to say so and is not shown.
- The #188 security review found that a local process can fill `otlp_series` to
  its ceiling using points valued zero. Those create series rows but write no
  cost rows, so the flood produces no cost-dashboard signal whatsoever, and
  every new sender is refused from then on. The only evidence is
  `otlpSeriesCount` and `otlpSeriesRefused`, which nothing displays.

The second is the sharper one: an install can be denied cost tracking entirely,
and the dashboard looks healthy, because nothing wrong ever gets recorded.

## 2. Decisions

### D1. A caveat renders beside the figure it qualifies

`excluded_entries` already does this, so this design extends one idea rather
than introducing a second mechanism. A reader looking at a number sees, in the
same place, whether that number is complete.

**Rejected:** a single banner listing everything currently incomplete. Cheaper
and impossible to miss, but it tells you a figure somewhere is a floor without
saying which, and the mapping from caveat to number is the useful part.

**Rejected:** a permanent Data Health panel. A card of mostly-zeroes is the
kind of furniture people stop reading, which defeats a signal that only matters
on the rare occasion it fires.

### D2. Nothing renders on a healthy install

Every signal in this design is absent when its count is zero. `AlertBanner`
already sets this precedent by returning `null` when there are no blockers.

The point is not tidiness. A caveat that is always on screen becomes part of
the furniture and stops being read, so it would be least effective exactly when
it finally means something.

### D3. Signals that qualify no figure get one conditional line, not a badge

A badge needs a host number. Three counters have none, because they describe
data discarded before it ever became a figure:

- `otlpUnmapped`: points arrived from a runner we have no mapper for.
- `otlpSeriesRefused`: points refused because the series cap is reached.
- `otlpSeriesCount`: how close the install is to that cap.

These get a single line in the cost area, rendered only when there is something
to say, in the same spirit as D2. Not a panel and not a permanent widget: a
sentence that appears when data is being dropped and is otherwise absent.

**Rejected:** attaching them to Total Spend anyway. It would put a caveat about
data that never arrived onto a figure computed from data that did, which is a
different claim and a misleading one.

**Rejected:** leaving them at the API, as today. That is the state the #188
review identified as the problem, where a denied install looks healthy.

### D4. `spend_today` is corrected here or the row lies

The KPI row's Spend Today comes from `GET /api/stats`, whose `spend_today` is a
bare total from `getSpendToday`. That query excludes unpriced rows and carries
no count beside it, so it understates with nothing to indicate it. This is
already recorded as a known limitation in `docs/ingestion.md`.

Fixing it is in scope because this design otherwise puts an honest caveat on
every cost figure on the dashboard except one, and the inconsistent one is the
most prominent.

`getSpendToday` returns a bare `number` today, and its value must not change.
So it gains a sibling rather than a shape: a second function, or a second
field on a returned object, supplying the count of unpriced rows in the same
window. On the API, `spend_today` stays exactly the number it is now and
`spend_today_unpriced` appears beside it. Turning `spend_today` into an object
would be a breaking change to a field the dashboard and any other client
already read, for no gain over adding one.

**Rejected:** leaving it and documenting it again. A figure that is
demonstrably a floor, sitting beside figures now labelled as floors, reads as
the complete one.

## 3. Goals and non-goals

**Goals**

1. Every cost figure on the dashboard says when it is not the whole truth.
2. An install whose data is being discarded shows that, rather than looking
   healthy.
3. A healthy install looks exactly as it does today.

**Non-goals**

New endpoints. Any change to what is stored or how anything is priced. Making
the counters durable: `otlpUnmapped` and `otlpSeriesRefused` remain
process-lifetime, which is documented and unchanged here. Alerting, email, or
anything that leaves the page.

## 4. What renders where

### 4.1 Badges on figures

| Figure | Signal | Reads |
|---|---|---|
| Total Spend KPI | `unpriced_entries` | `N unpriced` |
| Total Spend KPI | `unattributed` + `otlpUnattributed` | `N unattributed` |
| Cost by Model row | `unpriced_entries` | `N unpriced` |
| Cost by Agent row | `unpriced_entries` | `N unpriced` |
| Cost by Agent row | `excluded_entries` | `N excluded` |
| Spend Today KPI | new unpriced count, see D4 | `N unpriced` |

Each badge carries an explanation saying what the number means and, for
unpriced, that the total is a floor rather than the whole figure.

That explanation is not a `title` attribute, and not an `aria-label` either. A
`title` reaches a mouse and nothing else: it is announced inconsistently across
NVDA/JAWS/VoiceOver and never opens on keyboard focus, failing WCAG 1.4.13 and
4.1.2. An `aria-label` on the badge would replace the visible text, so a screen
reader would hear the caveat but lose which figure it qualifies and by how much.

So `CountBadge` renders a real `<button>` whose accessible name is the visible
text (`7 unpriced`) and whose accessible description is the explanation, wired
by `aria-describedby` to a `role="tooltip"` element. That element stays in the
DOM, visually hidden, so the description is available without a hover; it
becomes a visible tooltip on focus as well as hover, and Escape dismisses it
without moving focus. This matches the existing `MetricInfoTip` pattern rather
than introducing a second one.

Every badge in the table above goes through `CountBadge`, so all six inherit
this rather than each call site re-deciding.

The shipped `excluded_entries` badge read `+N excluded`. It is unified to
`N excluded` here so one component serves every caveat rather than the
dashboard carrying two idioms for the same idea.

Wording is deliberate. "Unpriced" says we recorded the tokens and could not
price them, which is the truth. It must not read as an error, because nothing
went wrong: an unknown model is an expected, visible state.

### 4.2 The dropped-data line

Rendered in the cost area, above the cost cards, only when any of the three is
non-zero:

- `otlpUnmapped > 0`: points from a runner with no mapper were ignored.
- `otlpSeriesRefused > 0`: points were refused because the series cap is full.
- `otlpSeriesCount` at or near the cap: the install is out of room.

It names the counter and points at `docs/ingestion.md`, so a reader has
somewhere to go. It states that the two point counters reset on restart, since
a reader comparing them against a durable-looking series count would otherwise
draw the wrong conclusion.

### 4.3 Data flow

`DashboardView` gains a fetch of `GET /api/ingest/status` alongside the cost
fetches it already performs, on the same refresh. Nothing consumes that
endpoint today, so this is new wiring rather than an extension.

A failed status fetch must not blank the cost view. It is supplementary: if it
fails, the badges that depend on it are absent and the cost figures still
render. The existing `loadCostData` already swallows its own failure with a
`console.warn` and returns false; follow that.

## 5. Error handling

| Condition | Behaviour |
|---|---|
| A counter is absent from the response | Treated as zero, badge absent |
| A counter is not a number | Treated as zero, badge absent |
| The status fetch fails | Cost figures render, dropped-data line absent |
| Every counter is zero | Nothing renders, page identical to today |

Every count is read through a guard rather than trusted, matching how
`CostCards.tsx` already handles totals: these cards render in a tree with no
ErrorBoundary, so one bad value blanks the dashboard rather than one card.

## 6. Testing

- A badge appears when its count is above zero and is absent at zero.
- A badge is absent when the field is missing entirely, as an older server
  would send.
- A nonsense value renders no badge rather than rendering the nonsense.
- The dropped-data line is absent when all three counters are zero, and present
  when any one is not.
- A failed status fetch leaves the cost figures rendered.
- Spend Today shows an unpriced count when the window contains unpriced rows.
- Wording: the unpriced badge's tooltip says the total is a floor.

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Badges crowd the figures and get ignored | Medium | They render only when non-zero, so a healthy install is unchanged and a badge appearing is itself the signal |
| A reader takes "unpriced" as an error | Low | Wording and tooltip say the tokens were recorded and the model was not in the price table |
| The dropped-data line fires constantly on a flooded install | Low | It is telling the truth; that install genuinely is discarding data until the cap is raised |
| `spend_today` change alters an existing figure | Medium | The total itself does not change. Only a count is added beside it |

## 8. Success criteria

1. On an install with unpriced rows, the total that excludes them says so.
2. On an install whose series cap is full, the dashboard says data is being
   refused, rather than looking healthy.
3. On a clean install, the dashboard is pixel-identical to today.
4. A failing status fetch never blanks a cost figure.
