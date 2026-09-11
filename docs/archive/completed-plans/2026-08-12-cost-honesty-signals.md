# Cost Honesty Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every cost figure on the dashboard say when it is not the whole truth, and make an install whose data is being discarded show that rather than looking healthy.

**Architecture:** One shared badge component renders a caveat beside the figure it qualifies, absent when its count is zero. Three counters describe data discarded before it became a figure and have no host number, so they get one conditional line instead. `DashboardView` gains a fetch of `GET /api/ingest/status`, which nothing currently consumes.

**Tech Stack:** React 19 with inline styles and CSS variables, TypeScript (ESM, explicit `.js` extensions), Express 5 route factories, Vitest with jsdom for component tests.

## Global Constraints

Copied from the spec and the repository's CLAUDE.md. Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-12-cost-honesty-signals-design.md`. Read it before Task 1.
- **All DB functions take `db: Database.Database` as the first parameter.**
- **Imports:** ESM with explicit `.js` extensions on relative imports.
- **Components** are functional with typed props interfaces. Styling is inline with CSS variables; no CSS modules.
- **Tests** live in `tests/`, named `*.test.ts` or `*.test.tsx`. Component tests carry `// @vitest-environment jsdom` as their first line and use `@testing-library/react`, following `tests/components/CostCards.test.tsx`.
- **Style:** Australian English in prose and documents. No em-dashes there, no emojis anywhere. Code comments follow the surrounding repository convention, which does use em-dashes.
- **Nothing renders on a healthy install.** Every signal here is absent when its count is zero. That is D2 and it is the point, not a detail.
- **No count is ever trusted.** These cards render in a tree with no ErrorBoundary, so one bad value blanks the dashboard rather than one card. Read every count through a guard, as `CostCards.tsx` already does for totals.
- **The gate before any completing commit** is the `finish-task` skill.

### A wording rule that matters

"Unpriced" must not read as an error. Nothing went wrong: the tokens were recorded and the model was not in the price table, which is an expected and deliberately visible state. The badge says what is true and the tooltip says the total is a floor rather than the whole figure.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db/costs.ts` (modify) | `getSpendTodayUnpriced`, beside the existing `getSpendToday` |
| `server/routes/system.ts` (modify) | `spend_today_unpriced` on `GET /api/stats` |
| `src/hooks/useApi.ts` (modify) | `getIngestStatus`, and `spend_today_unpriced` on `getStats`'s type |
| `src/components/dashboard/CountBadge.tsx` (create) | The one badge, with its zero and nonsense guards |
| `src/components/dashboard/CostCards.tsx` (modify) | Unpriced badges on Cost by Model and Cost by Agent |
| `src/components/dashboard/TodayCard.tsx` (modify) | Unpriced badge on Spend Today |
| `src/components/DashboardView.tsx` (modify) | The status fetch, the Total Spend badges, the dropped-data line |
| `src/components/dashboard/DroppedDataNotice.tsx` (create) | The conditional line for counters with no host figure |
| `tests/components/TodayCard.test.tsx` (modify) | The Spend Today unpriced badge |
| `tests/components/CountBadge.test.tsx` (create) | Zero, absent, nonsense, and the rendered text |
| `tests/components/CostCards.test.tsx` (modify) | Unpriced badges, and the excluded badge's new wording |
| `tests/components/DroppedDataNotice.test.tsx` (create) | Absent when healthy, present per counter |
| `tests/spend-today-unpriced.test.ts` (create) | The backend count |

---

### Task 1: The Spend Today unpriced count

**Files:**
- Modify: `server/db/costs.ts`
- Modify: `server/routes/system.ts`
- Test: `tests/spend-today-unpriced.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function getSpendTodayUnpriced(db: Database.Database): number`
  - `spend_today_unpriced` on the `GET /api/stats` response.

**Why a sibling and not a shape change.** `getSpendToday` returns a bare `number` and `spend_today` is already read by the dashboard and by any other client. Turning either into an object would break them for no gain over adding one field. The spec fixes this shape in D4; do not "tidy" it into a single object.

- [ ] **Step 1: Write the failing test**

Create `tests/spend-today-unpriced.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { getSpendToday, getSpendTodayUnpriced } from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

function addCost(db: Database.Database, id: string, cost: number | null, when: string): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, NULL, NULL, 'some-model', 'anthropic', 10, 10, ?, ?, 'transcript', ?)`
  ).run(id, cost, when, `ext-${id}`);
}

function today(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

describe("getSpendTodayUnpriced", () => {
  it("is zero when every row today is priced", () => {
    addCost(db, "a", 5, today());
    expect(getSpendTodayUnpriced(db)).toBe(0);
  });

  it("counts the rows today whose cost is unknown", () => {
    // These contribute nothing to getSpendToday, because SQL SUM skips NULL.
    // That is exactly why the count has to travel beside the total.
    addCost(db, "a", 5, today());
    addCost(db, "b", null, today());
    addCost(db, "c", null, today());

    expect(getSpendTodayUnpriced(db)).toBe(2);
    expect(getSpendToday(db)).toBeCloseTo(5, 10);
  });

  it("ignores unpriced rows from before today", () => {
    // The count has to describe the same window as the total it qualifies, or
    // it explains a figure the reader is not looking at.
    addCost(db, "old", null, yesterday());
    expect(getSpendTodayUnpriced(db)).toBe(0);
  });

  it("is zero on an empty database", () => {
    expect(getSpendTodayUnpriced(db)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/spend-today-unpriced.test.ts`
Expected: FAIL. `getSpendTodayUnpriced` is not exported.

- [ ] **Step 3: Add the query**

In `server/db/costs.ts`, immediately after `getSpendToday`, add:

```ts
/**
 * How many of today's rows could not be priced.
 *
 * Travels beside getSpendToday rather than inside it: that function returns a
 * bare number which the dashboard and any other client already read, and
 * turning it into an object to carry one extra field would break them for no
 * gain.
 *
 * The window and the exclusion must match getSpendToday exactly. A count over
 * a different window would explain a figure the reader is not looking at,
 * which is worse than no count at all.
 */
export function getSpendTodayUnpriced(db: Database.Database): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM cost_entries
       WHERE created_at >= ? AND cost_usd IS NULL AND ${excludeObservedCondition()}`
    )
    .get(todayStart.toISOString()) as { n: number };
  return row.n;
}
```

Export it from `server/db/index.ts` alongside `getSpendToday`.

- [ ] **Step 4: Add it to the stats route**

In `server/routes/system.ts`, add to the `res.json({...})` beside `spend_today`:

```ts
      spend_today_unpriced: getSpendTodayUnpriced(db),
```

Import it alongside the existing `getSpendToday` import rather than adding a second import line.

- [ ] **Step 5: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS, lint 0 problems. `spend_today` itself must not move: if any existing assertion on it changes, the window or the exclusion has drifted.

```bash
git add server/db/costs.ts server/db/index.ts server/routes/system.ts tests/spend-today-unpriced.test.ts
git commit -m "feat(costs): report how many of today's rows could not be priced"
```

---

### Task 2: The badge, and the cost cards

**Files:**
- Create: `src/components/dashboard/CountBadge.tsx`
- Modify: `src/components/dashboard/CostCards.tsx`
- Test: `tests/components/CountBadge.test.tsx` (create)
- Test: `tests/components/CostCards.test.tsx` (modify)

**Interfaces:**
- Consumes: nothing.
- Produces: `CountBadge`, taking `{ count, label, title, tone? }` and rendering nothing unless `count` is a finite number above zero.

**One deliberate change to shipped behaviour.** The excluded badge currently reads `+7 excluded`. This task unifies it to `7 excluded` so one component serves every caveat and the dashboard does not carry two idioms for the same idea. That changes an existing assertion in `tests/components/CostCards.test.tsx`; update it and say so in the commit. Do not keep the `+` by special-casing one caller.

- [ ] **Step 1: Write the failing test**

Create `tests/components/CountBadge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountBadge } from "../../src/components/dashboard/CountBadge";

describe("CountBadge", () => {
  it("renders the count and its label", () => {
    render(<CountBadge count={7} label="unpriced" title="seven of them" />);
    expect(screen.getByText("7 unpriced")).toBeTruthy();
  });

  it("renders nothing at zero, so a healthy install is unchanged", () => {
    const { container } = render(<CountBadge count={0} label="unpriced" title="t" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the count is absent", () => {
    // An older server, or a payload shape we did not expect.
    const { container } = render(<CountBadge count={undefined} label="unpriced" title="t" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for a nonsense count rather than rendering the nonsense", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const { container } = render(<CountBadge count={bad} label="unpriced" title="t" />);
      expect(container.textContent).toBe("");
    }
  });

  it("carries its explanation as a title", () => {
    render(<CountBadge count={2} label="unpriced" title="the total is a floor" />);
    expect(screen.getByText("2 unpriced").getAttribute("title")).toBe("the total is a floor");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/CountBadge.test.tsx`
Expected: FAIL. The component does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/dashboard/CountBadge.tsx`:

```tsx
/**
 * A caveat rendered beside the figure it qualifies.
 *
 * Renders nothing unless the count is a finite number above zero. That guard
 * lives here, in one place, rather than at each call site: a caveat that is
 * always on screen becomes furniture and stops being read, so it would be
 * least effective exactly when it finally means something.
 *
 * The count is validated rather than trusted because these cards render in a
 * tree with no ErrorBoundary. One bad value from an older server would
 * otherwise blank the whole dashboard instead of one badge.
 */
export function CountBadge({
  count,
  label,
  title,
  tone = "var(--accent-purple)",
}: Readonly<{
  count: number | null | undefined;
  label: string;
  title: string;
  tone?: string;
}>) {
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return null;

  return (
    <span
      title={title}
      style={{ color: tone, marginLeft: "4px", cursor: "help", whiteSpace: "nowrap" }}
    >
      {count} {label}
    </span>
  );
}
```

- [ ] **Step 4: Use it in the cost cards**

In `src/components/dashboard/CostCards.tsx`:

- Add `unpriced_entries?: number | null` to both `CostByModelEntry` and `CostByAgentEntry`, with the same nullable reasoning the existing fields carry.
- Replace the inline excluded badge with `<CountBadge count={a.excluded_entries} label="excluded" title={excludedTitle(...)} />`, keeping `excludedTitle`.
- Add an unpriced badge to each Cost by Model and Cost by Agent row:

```tsx
<CountBadge
  count={m.unpriced_entries}
  label="unpriced"
  title={
    `${m.unpriced_entries} entries here have tokens recorded but no cost, because the model ` +
    `is not in the price table. Nothing went wrong: this figure is a floor, not the whole amount.`
  }
  tone="var(--text-muted)"
/>
```

Delete `excludedCount` if `CountBadge`'s guard makes it unused. Do not leave a second guard behind.

- [ ] **Step 5: Update the existing excluded assertion**

`tests/components/CostCards.test.tsx` asserts `+7 excluded` in two places, at lines 38 and 44. Change both to `7 excluded` and add a comment saying the wording was unified so one component serves every caveat. Do not delete the tests: they still pin that the badge appears, which is the behaviour that matters.

Add tests to the same file for the unpriced badge on both cards: present above zero, absent at zero, absent when the field is missing.

- [ ] **Step 6: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS, lint 0 problems.

```bash
git add src/components/dashboard/CountBadge.tsx src/components/dashboard/CostCards.tsx tests/components/CountBadge.test.tsx tests/components/CostCards.test.tsx
git commit -m "feat(dashboard): one badge for every cost caveat, and unpriced on the cost cards"
```

---

### Task 3: The status fetch, and the two headline figures

**Files:**
- Modify: `src/hooks/useApi.ts`
- Modify: `src/components/DashboardView.tsx`
- Modify: `src/components/dashboard/TodayCard.tsx`
- Test: `tests/components/TodayCard.test.tsx` (modify, it already exists)

**Interfaces:**
- Consumes: `CountBadge` from Task 2, `spend_today_unpriced` from Task 1.
- Produces:
  - `getIngestStatus()` on the API hook, returning the status payload.
  - `IngestStatus` state on `DashboardView`, available to Task 4.

**Why the fetch lands here.** Nothing in `src/` reads `GET /api/ingest/status` today, so this is new wiring. Total Spend needs it for the unattributed count, and Task 4's line needs it entirely.

- [ ] **Step 1: Add the API call**

In `src/hooks/useApi.ts`, add beside the other cost calls:

```ts
async function getIngestStatus(): Promise<{
  filesTracked: number; transcriptRows: number; unpriced: number; unattributed: number;
  otlpRows: number; otlpUnmapped: number; otlpUnattributed: number;
  otlpSeriesCount: number; otlpSeriesRefused: number;
}> {
  const res = await apiFetch("/api/ingest/status");
  if (!res.ok) await throwApiError(res, "getIngestStatus");
  return res.json();
}
```

Add `spend_today_unpriced: number;` to `getStats`'s return type, and add `getIngestStatus` to the returned object at the bottom of the hook.

- [ ] **Step 2: Fetch it in DashboardView**

Extend `loadCostData` to fetch the status alongside the cost calls, and store it in new state. It must not blank the cost view when it fails: request it separately from the `Promise.all` that already guards the cost calls, catch its failure, `console.warn`, and leave the state null. The spec is explicit that this data is supplementary.

- [ ] **Step 3: Badge Total Spend**

The Total Spend KPI already carries a tooltip for `excluded_entries`. Add badges beside its value for `unpriced_entries` (from the cost summary) and for unattributed (the sum of the status payload's `unattributed` and `otlpUnattributed`).

`KpiCard` takes `value: string`, so it cannot host a React node today. Widen `value` to `string | ReactNode` rather than stringifying a badge, and keep every existing caller working unchanged.

The unattributed tooltip should say the spend is recorded but tied to no project, so the global total exceeds the sum of the per-project figures. That is the actual consequence and it is what a reader needs.

- [ ] **Step 4: Badge Spend Today**

`TodayCard` takes `spendToday: number`. Add `spendTodayUnpriced?: number` and render a `CountBadge` beside the figure. `DashboardView` passes `stats.spend_today_unpriced`.

`tests/components/TodayCard.test.tsx` already exists. Add to it: the badge appears above zero, is absent at zero, and is absent when the prop is omitted, which is what an older server produces. Leave its existing assertions alone; the spend figure itself does not change.

- [ ] **Step 5: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS, lint 0 problems.

```bash
git add src/hooks/useApi.ts src/components/DashboardView.tsx src/components/dashboard/TodayCard.tsx tests/components/TodayCard.test.tsx
git commit -m "feat(dashboard): fetch ingest status and caveat the two headline figures"
```

---

### Task 4: The dropped-data line

**Files:**
- Create: `src/components/dashboard/DroppedDataNotice.tsx`
- Modify: `src/components/DashboardView.tsx`
- Test: `tests/components/DroppedDataNotice.test.tsx` (create)

**Interfaces:**
- Consumes: the status state from Task 3.
- Produces: `DroppedDataNotice`, taking the three counters and the cap.

**What this exists for.** A local process can fill `otlp_series` with zero-valued points, which create series rows but write no cost rows. The flood produces no cost-dashboard signal at all, and every new sender is refused from then on. This line is the only thing that would show it. It is the reason the spec exists.

- [ ] **Step 1: Write the failing test**

Create `tests/components/DroppedDataNotice.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DroppedDataNotice } from "../../src/components/dashboard/DroppedDataNotice";

const healthy = { otlpUnmapped: 0, otlpSeriesRefused: 0, otlpSeriesCount: 12 };

describe("DroppedDataNotice", () => {
  it("renders nothing on a healthy install", () => {
    const { container } = render(<DroppedDataNotice {...healthy} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the status is unavailable", () => {
    const { container } = render(<DroppedDataNotice />);
    expect(container.textContent).toBe("");
  });

  it("says so when points from an unrecognised runner were ignored", () => {
    render(<DroppedDataNotice {...healthy} otlpUnmapped={40} />);
    expect(screen.getByText(/40/)).toBeTruthy();
    expect(screen.getByText(/no mapper|not recognised/i)).toBeTruthy();
  });

  it("says so when the series cap refused points", () => {
    render(<DroppedDataNotice {...healthy} otlpSeriesRefused={5} />);
    expect(screen.getByText(/5/)).toBeTruthy();
  });

  it("warns when the series table is at its ceiling", () => {
    // The stealth case: a flood of zero-valued points fills the table and
    // writes no cost rows, so this count is the only evidence anywhere.
    render(<DroppedDataNotice otlpUnmapped={0} otlpSeriesRefused={0} otlpSeriesCount={10000} />);
    expect(screen.getByText(/10000|ceiling|full/i)).toBeTruthy();
  });

  it("says the point counters reset on restart", () => {
    render(<DroppedDataNotice {...healthy} otlpUnmapped={1} />);
    expect(screen.getByText(/restart/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/DroppedDataNotice.test.tsx`
Expected: FAIL. The component does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/dashboard/DroppedDataNotice.tsx`. Requirements rather than verbatim code, because the wording is the deliverable:

- Props are all optional numbers: `otlpUnmapped`, `otlpSeriesRefused`, `otlpSeriesCount`, and `seriesCap` defaulting to 10000.
- Returns `null` unless at least one of: `otlpUnmapped > 0`, `otlpSeriesRefused > 0`, or `otlpSeriesCount >= seriesCap`.
- Every count read through the same guard style as `CountBadge`: not a finite number means treat as zero.
- One line per condition that fires, each naming its counter so a reader can find it on `GET /api/ingest/status`.
- One sentence stating that the two point counters reset when the server restarts, while the series count does not. Without it a reader comparing them draws the wrong conclusion.
- A link to `docs/ingestion.md`.
- Style it as a notice, not an error: this is information about data we did not record, not a failure. Use `var(--text-muted)` and a subtle border rather than an alarm colour.

Render it in `DashboardView` above the cost cards, passing the status state.

- [ ] **Step 4: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS, lint 0 problems.

```bash
git add src/components/dashboard/DroppedDataNotice.tsx src/components/DashboardView.tsx tests/components/DroppedDataNotice.test.tsx
git commit -m "feat(dashboard): say when OTLP data is being discarded"
```

---

### Task 5: Documentation

No code. `docs/ingestion.md` currently records two of the things this branch fixes as outstanding, and leaving those claims would make the page wrong in the direction of understating what the tool does.

**Files:**
- Modify: `docs/ingestion.md`

- [ ] **Step 1: Retire the claims this branch fixes**

The page says of Spend Today: "the 'Spend Today' number on the dashboard comes from `GET /api/stats` and is a bare total with no count beside it, so it silently excludes unpriced rows. Plumbing the count through it is tracked as follow-up work." That is now false. Rewrite it to say the count travels with the figure.

Search the page for any other statement that a counter exists only on the API and is not shown, and correct what is no longer true.

- [ ] **Step 2: Say what a reader now sees**

Add a short passage saying that the dashboard shows these caveats beside the figures they qualify, that nothing appears when there is nothing to report, and that a count of discarded data appears in the cost area when it is not zero.

Verify each claim against the components before writing it.

- [ ] **Step 3: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add docs/ingestion.md
git commit -m "docs: the dashboard now shows where a figure is incomplete"
```

---

## Final verification

Before opening the PR, run the `finish-task` skill. Beyond its checklist, confirm the spec's four success criteria:

1. On an install with unpriced rows, the total that excludes them says so.
2. On an install whose series cap is full, the dashboard says data is being refused rather than looking healthy.
3. **On a clean install the dashboard is unchanged.** Verify this by rendering with every counter at zero and asserting nothing new appears. It is the criterion most easily broken by a well-meaning "always show the count" change.
4. A failing status fetch never blanks a cost figure.

Verify 1 and 2 in the running app, not only in tests. Seed a scratch database rather than the developer's own, following the approach recorded in the ledger for the `excluded_entries` badge: set `VIBE_DASH_DB` to a temporary path via a throwaway entry in `.claude/launch.json`, and remove both afterwards.
