# Observed-Cost Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark an agent as already observed through its transcripts, so its self-reported `log_cost` rows stop double counting in every cost total.

**Architecture:** One boolean column on `agents`, one shared SQL condition applied to all six queries that read `cost_entries`, one read-only overlap report on the ingest status endpoint, and one setter route. Nothing is deleted and nothing is auto-marked.

**Tech Stack:** TypeScript (ESM, explicit `.js` extensions), better-sqlite3 with raw SQL, Express 5 route factories, Vitest integration tests against a real in-memory database.

## Global Constraints

Copied from the spec and the repository's CLAUDE.md. Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-10-observed-cost-exclusion-design.md`. Read it before Task 1.
- **No ORM.** Raw SQL with better-sqlite3 prepared statements.
- **All DB functions take `db: Database.Database` as the first parameter.**
- **Timestamps** are ISO 8601 strings via `new Date().toISOString()`.
- **Imports:** ESM with explicit `.js` extensions on relative imports.
- **Naming:** PascalCase types, camelCase functions, snake_case DB columns and tables.
- **Error responses** are `{ error: "message" }` with an appropriate status. Mutation endpoints broadcast a WebSocket event and are rate limited.
- **Tests** live in `tests/`, named `*.test.ts`, get a fresh in-memory DB via `createTestDb()` from `./setup.js` in a `beforeEach`, and are integration style against a real database with no mocking. The HTTP helper is `requestApp(app, method, path, body)` returning `{ status, body }`; it is not supertest.
- **Style:** Australian English in prose and documents (README, docs/, commit messages). No em-dashes there, no emojis anywhere. Code comments follow the surrounding repository convention, which does use em-dashes.
- **Nothing is ever auto-marked.** The system must never conclude on its own that an agent is observed.
- **No cost row is ever deleted.**
- **The gate before any completing commit** is the `finish-task` skill.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db/migrator.ts` (modify) | Migration `021_agent_cost_observed` |
| `server/db/agents.ts` (modify) | `setAgentCostObserved(db, agentId, observed)` |
| `server/db/costs.ts` (modify) | The exclusion condition, and its application to all six queries. Task 3 exports the condition so the overlap query reuses it. |
| `server/ingest/transcripts/sync.ts` (modify) | `overlaps` on `getIngestStatus` |
| `server/routes/agents.ts` (modify) | `POST /api/agents/:id/cost-observed` |
| `shared/types.ts` (modify) | `Agent.cost_observed_externally`, `CostOverlap` |
| `tests/observed-cost.test.ts` (create) | Exclusion behaviour across the cost queries |
| `tests/ingest-overlaps.test.ts` (create) | Overlap detection |
| `tests/agents-cost-observed.test.ts` (create) | The setter route |
| `server/mcp/tools.ts` (modify) | `log_cost` resolves the session agent, so its rows are excludable |
| `tests/mcp-log-cost-agent.test.ts` (create) | Agent attribution on `log_cost` |

---

### Task 1: Migration 021 and the setter function

**Files:**
- Modify: `server/db/migrator.ts` (append to `MIGRATIONS`, after `020_cost_usd_nullable`)
- Modify: `server/db/agents.ts`
- Modify: `shared/types.ts`
- Test: `tests/observed-cost.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Column `agents.cost_observed_externally INTEGER NOT NULL DEFAULT 0`
  - `function setAgentCostObserved(db: Database.Database, agentId: string, observed: boolean): Agent | null`, returning the updated agent, or `null` when no agent has that id.
  - `Agent.cost_observed_externally: number` (0 or 1).

- [ ] **Step 1: Write the failing test**

Create `tests/observed-cost.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, getAgentById, setAgentCostObserved } from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

describe("agents.cost_observed_externally", () => {
  it("defaults to 0 so an upgrade changes no existing total", () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("marks and unmarks an agent", () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    const marked = setAgentCostObserved(db, agent.id, true);
    expect(marked!.cost_observed_externally).toBe(1);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);

    const unmarked = setAgentCostObserved(db, agent.id, false);
    expect(unmarked!.cost_observed_externally).toBe(0);
  });

  it("returns null for an agent that does not exist", () => {
    expect(setAgentCostObserved(db, "no-such-agent", true)).toBeNull();
  });
});
```

If `registerAgent`'s signature differs from `registerAgent(db, { name, model, capabilities })`, read `server/db/agents.ts:25` and use the real one. Do not change production code to fit the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/observed-cost.test.ts`
Expected: FAIL. `setAgentCostObserved` is not exported.

- [ ] **Step 3: Add the migration**

Append to the `MIGRATIONS` array in `server/db/migrator.ts`, after `020_cost_usd_nullable`, following the guarded-`has` pattern the other agent-column migrations use:

```ts
  {
    name: "021_agent_cost_observed",
    run(db) {
      // Marks an agent whose spend we already read from its transcripts, so
      // its self-reported log_cost rows are duplicates rather than new spend.
      // Excluded at query time in server/db/costs.ts; the rows are never
      // deleted, because destroying money records to fix a reporting bug
      // removes the audit trail that makes the fix checkable.
      //
      // Defaults to 0, so this migration moves no existing total on its own.
      // Nothing sets it automatically: concluding that an agent is Claude Code
      // would be exactly the guess this feature refuses to make.
      const cols = db.pragma("table_info(agents)") as { name: string }[];
      const has = (name: string): boolean => cols.some((c) => c.name === name);
      if (!has("cost_observed_externally")) {
        db.prepare(
          "ALTER TABLE agents ADD COLUMN cost_observed_externally INTEGER NOT NULL DEFAULT 0"
        ).run();
      }
    },
  },
```

- [ ] **Step 4: Add the field to the shared Agent type**

In `shared/types.ts`, add to the `Agent` interface, after `current_status_at`:

```ts
  /**
   * 1 when this agent's spend is already read from its transcripts, so its
   * log_cost rows are duplicates and are excluded from cost totals.
   *
   * A number rather than a boolean because SQLite has no boolean type and this
   * project uses raw SQL with no ORM layer to map it.
   */
  cost_observed_externally: number;
```

- [ ] **Step 5: Add the setter**

In `server/db/agents.ts`, after `setAgentStatus`:

```ts
/**
 * Mark or unmark an agent as already observed through its transcripts.
 *
 * Always an explicit human action. Nothing in the ingestion path calls this,
 * because inferring that an agent is Claude Code and silently dropping its
 * self-reported spend is the guess this feature exists to avoid.
 */
export function setAgentCostObserved(
  db: Database.Database,
  agentId: string,
  observed: boolean
): Agent | null {
  const changed = db
    .prepare("UPDATE agents SET cost_observed_externally = ? WHERE id = ?")
    .run(observed ? 1 : 0, agentId).changes;
  return changed > 0 ? getAgentById(db, agentId) : null;
}
```

Then export it from `server/db/index.ts` alongside the other agent functions, matching however that file re-exports them.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/observed-cost.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. If `tests/migrator.test.ts` asserts on the migration list, update it to include `021_agent_cost_observed` rather than weakening the assertion.

- [ ] **Step 8: Commit**

```bash
git add server/db/migrator.ts server/db/agents.ts server/db/index.ts shared/types.ts tests/observed-cost.test.ts
git commit -m "feat(db): add the agent cost-observed flag and its setter"
```

---

### Task 2: Exclude observed agents from every cost total

**Files:**
- Modify: `server/db/costs.ts`
- Test: `tests/observed-cost.test.ts` (extend)

**Interfaces:**
- Consumes: `agents.cost_observed_externally` and `setAgentCostObserved` from Task 1.
- Produces: no new exports. Every existing exported function in `costs.ts` gains the exclusion.

**The one non-obvious mechanic.** `buildWhere` in `server/db/where.ts` pushes a parameter for every clause it accepts, so a parameter-free condition cannot go through it. Each call site composes the condition into its `WHERE` directly, using the `withExclusion` helper below.

- [ ] **Step 1: Write the failing tests**

Append to `tests/observed-cost.test.ts`:

```ts
import {
  logCost, createProject, createMilestone,
  getGlobalCostSummary, getProjectCostSummary, getAgentCostSummary,
  getMilestoneCostSummary, getSpendToday, getCostByModel, getCostByAgent,
  getCostTimeseries,
} from "../server/db/index.js";

describe("excluding an observed agent's self-reported cost", () => {
  const seed = (db: Database.Database) => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    // The duplicate: this agent self-reported, and we also read its transcript.
    logCost(db, {
      agent_id: agent.id, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 10, output_tokens: 10, cost_usd: 5,
    });
    // The observation. Transcript rows carry no agent.
    db.prepare(
      `INSERT INTO cost_entries (id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('t1', ?, 'claude-opus-5', 'anthropic', 10, 10, 5, ?, 'transcript', 'uuid-1')`
    ).run(project.id, new Date().toISOString());

    return { project, agent };
  };

  it("halves a doubled global total once the agent is marked", () => {
    const { agent } = seed(db);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(10, 10);

    setAgentCostObserved(db, agent.id, true);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(5, 10);
  });

  it("restores the previous total when the agent is unmarked", () => {
    const { agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);
    setAgentCostObserved(db, agent.id, false);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(10, 10);
  });

  it("keeps the transcript row, dropping only the self-report", () => {
    const { project, agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);

    const summary = getProjectCostSummary(db, project.id);
    expect(summary.total_cost_usd).toBeCloseTo(5, 10);
    expect(summary.entry_count).toBe(1);
  });

  it("applies to spend-today, by-model, by-agent and the timeseries", () => {
    const { agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);

    expect(getSpendToday(db)).toBeCloseTo(5, 10);

    const byModel = getCostByModel(db);
    expect(byModel).toHaveLength(1);
    expect(byModel[0].total_cost_usd).toBeCloseTo(5, 10);

    // The only agent-attributed row was the excluded one, so the breakdown empties.
    expect(getCostByAgent(db)).toHaveLength(0);

    const total = getCostTimeseries(db).reduce((sum, d) => sum + d.total_cost_usd, 0);
    expect(total).toBeCloseTo(5, 10);
  });

  it("applies to the milestone summary too, covering every exported total", () => {
    // getAgentCostSummary, getProjectCostSummary and getMilestoneCostSummary all
    // route through getCostSummaryBy, but the spec's risk table promises every
    // exported cost function is covered, so name this one explicitly rather
    // than leaving it implied by a shared code path.
    const project = createProject(db, { name: "m-demo", description: null });
    // Every field but project_id and name is optional on CreateMilestoneInput.
    const milestone = createMilestone(db, { project_id: project.id, name: "m1" });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    logCost(db, {
      agent_id: agent.id, project_id: project.id, milestone_id: milestone.id,
      model: "claude-opus-5", provider: "anthropic",
      input_tokens: 1, output_tokens: 1, cost_usd: 7,
    });

    expect(getMilestoneCostSummary(db, milestone.id).total_cost_usd).toBeCloseTo(7, 10);
    setAgentCostObserved(db, agent.id, true);
    expect(getMilestoneCostSummary(db, milestone.id).total_cost_usd).toBeCloseTo(0, 10);
  });

  it("reads zero for a marked agent's own summary, deliberately", () => {
    // Its self-reports are duplicates, and the observation that replaced them
    // carries no agent, so there is nothing left to attribute to it. Surprising
    // enough to be worth pinning down rather than discovering later.
    const { agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);
    expect(getAgentCostSummary(db, agent.id).total_cost_usd).toBeCloseTo(0, 10);
  });

  it("never excludes a row with no agent, marked or not", () => {
    const project = createProject(db, { name: "orphan", description: null });
    logCost(db, {
      agent_id: null, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 1, output_tokens: 1, cost_usd: 3,
    });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    setAgentCostObserved(db, agent.id, true);

    // The condition's explicit agent_id IS NOT NULL guard keeps this row. That
    // is the documented limitation: an unattributed self-report cannot be
    // excluded by agent, so it must stay counted.
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(3, 10);
  });

  it("does not exclude an unmarked agent's rows", () => {
    const { agent } = seed(db);
    const other = registerAgent(db, { name: "cursor-bot", model: "claude-opus-5", capabilities: [] });
    setAgentCostObserved(db, other.id, true);
    void agent;

    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(10, 10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/observed-cost.test.ts`
Expected: FAIL. The marked-agent cases still return the doubled totals.

- [ ] **Step 3: Add the condition and its composer**

In `server/db/costs.ts`, beside the existing `totalCostSql` and `unpricedSql` fragments:

```ts
/**
 * Rows an observed agent self-reported, which duplicate what we already read
 * from its transcripts.
 *
 * Only `mcp` rows are excluded: the `transcript` row is the observation we
 * trust, and dropping it would delete the very figure that replaced the
 * duplicate. A row with a NULL agent_id is never excluded either, because
 * the explicit `agent_id IS NOT NULL` guard keeps it. That guard is
 * load-bearing: `NULL IN (<non-empty subquery>)` is NULL rather than FALSE, so
 * without it those rows would vanish once any agent was marked.
 *
 * A named constant rather than a string repeated at six call sites, so a query
 * added later cannot silently reintroduce double counting.
 */
const excludeObservedCondition = (prefix = ""): string =>
  `NOT (${prefix}source = 'mcp' AND ${prefix}agent_id IN ` +
  `(SELECT id FROM agents WHERE cost_observed_externally = 1))`;

/**
 * Compose the exclusion onto a WHERE clause that may or may not exist.
 *
 * buildWhere() cannot carry this: it pushes a parameter for every clause it
 * accepts, and this condition takes none.
 */
const withExclusion = (existingWhere: string, prefix = ""): string =>
  existingWhere.length > 0
    ? `${existingWhere} AND ${excludeObservedCondition(prefix)}`
    : `WHERE ${excludeObservedCondition(prefix)}`;
```

- [ ] **Step 4: Apply it to all six queries**

`getCostSummaryBy`, where the `WHERE` already exists:

```ts
     FROM cost_entries WHERE ${column} = ? AND ${excludeObservedCondition()}`
```

`getSpendToday`, where the `WHERE` already exists:

```ts
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_entries
       WHERE created_at >= ? AND ${excludeObservedCondition()}`
    )
```

`getGlobalCostSummary`, which has no `WHERE` today:

```ts
     FROM cost_entries ${withExclusion("")}`
```

`getCostTimeseries` and `getCostByModel` both build their clause with `buildWhere`. Replace the interpolation of `where` with `withExclusion(where)`.

`getCostByAgent` builds a `conditions` array. Push the condition with its table prefix:

```ts
  const conditions: string[] = ["c.agent_id IS NOT NULL", excludeObservedCondition("c.")];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/observed-cost.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS. Existing cost tests must be unaffected: with no agent marked the condition is true for every row, so no total may move. If any existing test changes, the condition is wrong.

- [ ] **Step 7: Commit**

```bash
git add server/db/costs.ts tests/observed-cost.test.ts
git commit -m "feat(costs): exclude an observed agent's self-reported rows from totals"
```

---

### Task 3: Report the overlap

**Files:**
- Modify: `server/ingest/transcripts/sync.ts` (`getIngestStatus`, around line 231)
- Modify: `shared/types.ts`
- Test: `tests/ingest-overlaps.test.ts` (create)

**Interfaces:**
- Consumes: `excludeObservedCondition` from Task 2, which must be exported from
  `server/db/costs.ts` as part of THIS task (Task 2 left it module-private).
  Export it there, add it to the `server/db/index.ts` re-export beside the other
  cost exports, and import it here. Do NOT retype the SQL: the spec makes it a
  shared named constant precisely so a later query cannot drift from it, and the
  `agent_id IS NOT NULL` guard inside it is load-bearing.
- Produces:
  - `interface CostOverlap { project_id: string; project_name: string; date: string; mcp_entries: number; transcript_entries: number; mcp_agent_names: string[] }` in `shared/types.ts`.
  - `getIngestStatus` return type gains `overlaps: CostOverlap[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest-overlaps.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject, registerAgent, setAgentCostObserved } from "../server/db/index.js";
import { getIngestStatus } from "../server/ingest/transcripts/sync.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const AT = (day: string): string => `${day}T10:00:00.000Z`;

function addCost(
  db: Database.Database,
  opts: { id: string; project: string; agent?: string | null; source: "mcp" | "transcript"; day: string }
): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, ?, ?, 'claude-opus-5', 'anthropic', 1, 1, 1, ?, ?, ?)`
  ).run(opts.id, opts.agent ?? null, opts.project, AT(opts.day), opts.source,
        opts.source === "transcript" ? `uuid-${opts.id}` : null);
}

describe("getIngestStatus overlaps", () => {
  it("reports a project and day carrying both sources", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap).toMatchObject({
      project_id: project.id,
      project_name: "demo",
      date: "2026-08-10",
      mcp_entries: 1,
      transcript_entries: 1,
    });
    expect(overlap.mcp_agent_names).toEqual(["claude"]);
  });

  it("stays quiet when the two sources fall on different days", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-09" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    expect(getIngestStatus(db).overlaps).toEqual([]);
  });

  it("names every distinct agent on the mcp side", () => {
    const project = createProject(db, { name: "demo", description: null });
    const a = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    const b = registerAgent(db, { name: "cursor-bot", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: a.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "m2", project: project.id, agent: b.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_entries).toBe(2);
    expect([...overlap.mcp_agent_names].sort()).toEqual(["claude", "cursor-bot"]);
  });

  it("stops reporting once the agent is marked", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    expect(getIngestStatus(db).overlaps).toHaveLength(1);
    setAgentCostObserved(db, agent.id, true);
    expect(getIngestStatus(db).overlaps).toEqual([]);
  });

  it("still reports a self-report that named no agent", () => {
    // It cannot be excluded by marking an agent, so it must stay visible.
    const project = createProject(db, { name: "demo", description: null });
    addCost(db, { id: "m1", project: project.id, agent: null, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_entries).toBe(1);
    expect(overlap.mcp_agent_names).toEqual([]);
  });

  it("still reports the agent-less self-report when a DIFFERENT agent is marked", () => {
    // The IS NOT NULL guard inside the shared condition is what makes this
    // pass. Without it the subquery is non-empty, NULL IN (...) is SQL NULL,
    // and the WHERE clause silently drops the row from the report.
    const project = createProject(db, { name: "demo", description: null });
    const other = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: null, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    setAgentCostObserved(db, other.id, true);

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_entries).toBe(1);
  });

  it("is empty on a database with no cost rows", () => {
    expect(getIngestStatus(db).overlaps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-overlaps.test.ts`
Expected: FAIL. `overlaps` is undefined on the status object.

- [ ] **Step 3: Add the shared type**

In `shared/types.ts`, after the `CostByAgentEntry` interface:

```ts
/**
 * A project and calendar day carrying cost from both sources at once.
 *
 * Reported rather than resolved: a second tool legitimately working on the same
 * project the same day looks identical to a duplicate, and only a person can
 * tell them apart. The agent names are what make that judgement quick.
 */
export interface CostOverlap {
  project_id: string;
  project_name: string;
  date: string;
  mcp_entries: number;
  transcript_entries: number;
  mcp_agent_names: string[];
}
```

- [ ] **Step 4: Implement the query**

In `server/ingest/transcripts/sync.ts`, replace `getIngestStatus` with:

```ts
interface OverlapRow {
  project_id: string;
  project_name: string;
  date: string;
  mcp_entries: number;
  transcript_entries: number;
  mcp_agent_names: string | null;
}

/** Counts behind GET /api/ingest/status, so skipped, unpriced and duplicated spend are all visible. */
export function getIngestStatus(db: Database.Database): {
  filesTracked: number; transcriptRows: number; unpriced: number; unattributed: number;
  overlaps: CostOverlap[];
} {
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

  // A project and day holding both a self-report and an observation. Agents
  // already marked as observed are filtered out, because their rows no longer
  // reach any total and so are no longer a discrepancy to act on.
  //
  // GROUP_CONCAT skips NULLs, and transcript rows carry no agent_id, so the
  // name list only ever describes the mcp side. A self-report that named no
  // agent contributes to mcp_entries with no name, which is the visible form
  // of the row that cannot be excluded by marking.
  const rows = db.prepare(`
    SELECT c.project_id                                             AS project_id,
           p.name                                                   AS project_name,
           DATE(c.created_at)                                        AS date,
           SUM(CASE WHEN c.source = 'mcp' THEN 1 ELSE 0 END)         AS mcp_entries,
           SUM(CASE WHEN c.source = 'transcript' THEN 1 ELSE 0 END)  AS transcript_entries,
           GROUP_CONCAT(DISTINCT a.name)                             AS mcp_agent_names
      FROM cost_entries c
      JOIN projects p ON p.id = c.project_id
      LEFT JOIN agents a ON a.id = c.agent_id
     WHERE c.project_id IS NOT NULL
       AND ${excludeObservedCondition("c.")}
     GROUP BY c.project_id, p.name, DATE(c.created_at)
    HAVING mcp_entries > 0 AND transcript_entries > 0
     ORDER BY date DESC, p.name
  `).all() as OverlapRow[];

  return {
    filesTracked: one(`SELECT COUNT(*) AS n FROM transcript_files`),
    transcriptRows: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript'`),
    unpriced: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND cost_usd IS NULL`),
    unattributed: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND project_id IS NULL`),
    overlaps: rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      date: r.date,
      mcp_entries: r.mcp_entries,
      transcript_entries: r.transcript_entries,
      mcp_agent_names: r.mcp_agent_names === null ? [] : r.mcp_agent_names.split(","),
    })),
  };
}
```

Add `import type { CostOverlap } from "../../../shared/types.js";` beside the file's existing imports. If `sync.ts` already imports from `shared/types.js`, extend that import instead of adding a second one.

Also add `import { excludeObservedCondition } from "../../db/costs.js";` and make
the query a template literal so the interpolation works. Because the fragment is
now interpolated into a second module, confirm the file still has no bound
parameters mismatched against placeholders: the fragment takes none.

Note the resulting subtlety and keep it: a self-report with no `agent_id` is
kept by the fragment's `IS NOT NULL` guard, so it keeps appearing in the overlap
report. That is correct. Marking an agent cannot remove such a row from the
totals, so it must stay visible as something only a person can resolve.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ingest-overlaps.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Confirm the status route still matches**

Run: `npx vitest run tests/ingest-routes.test.ts && npm test && npm run typecheck:all`
Expected: PASS. `GET /api/ingest/status` spreads `getIngestStatus(db)`, so `overlaps` appears with no route change. The existing status test asserts specific keys with `toMatchObject`, so an added key must not break it. If it does, extend that assertion rather than removing it.

- [ ] **Step 7: Commit**

```bash
git add server/ingest/transcripts/sync.ts shared/types.ts tests/ingest-overlaps.test.ts
git commit -m "feat(ingest): report projects where both cost sources overlap"
```

---

### Task 4: The setter route

**Files:**
- Modify: `server/routes/agents.ts`
- Test: `tests/agents-cost-observed.test.ts` (create)

**Interfaces:**
- Consumes: `setAgentCostObserved` from Task 1.
- Produces: `POST /api/agents/:id/cost-observed` taking `{ observed: boolean }` and returning the updated agent.

- [ ] **Step 1: Write the failing test**

Create `tests/agents-cost-observed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, getAgentById } from "../server/db/index.js";
import { agentRoutes } from "../server/routes/agents.js";
import { requestApp } from "./http-helper.js";

let db: Database.Database;
let app: Express;

function request(method: string, path: string, body?: unknown) {
  return requestApp(app, method, path, body);
}

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(agentRoutes(db, () => {}));
});

describe("POST /api/agents/:id/cost-observed", () => {
  it("marks an agent and returns it", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    const res = await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true });
    expect(res.status).toBe(200);
    expect((res.body as { cost_observed_externally: number }).cost_observed_externally).toBe(1);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);
  });

  it("unmarks an agent", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true });

    const res = await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: false });
    expect(res.status).toBe(200);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("404s for an agent that does not exist", async () => {
    const res = await request("POST", "/api/agents/no-such-agent/cost-observed", { observed: true });
    expect(res.status).toBe(404);
    expect((res.body as { error?: string }).error).toBeTruthy();
  });

  it("400s when observed is missing or not a boolean", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    expect((await request("POST", `/api/agents/${agent.id}/cost-observed`, {})).status).toBe(400);
    expect((await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: "yes" })).status).toBe(400);
  });

  it("broadcasts the updated agent", async () => {
    const events: { type: string }[] = [];
    app = express();
    app.use(express.json());
    app.use(agentRoutes(db, (e) => { events.push(e as { type: string }); }));

    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true });

    expect(events.map((e) => e.type)).toContain("agent_registered");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/agents-cost-observed.test.ts`
Expected: FAIL with 404 on every case, because the route does not exist.

- [ ] **Step 3: Add the route**

In `server/routes/agents.ts`, add the import for the rate limiter and the setter, then define a limiter above the route factory:

```ts
import rateLimit from "express-rate-limit";
```

```ts
// Marking an agent is a deliberate, occasional human action, so the ceiling
// only has to sit above real use.
const costObservedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many agent changes, please try again later." },
});
```

And inside the factory, after the existing routes:

```ts
  /**
   * POST /api/agents/:id/cost-observed — mark an agent as already observed
   * through its transcripts, so its self-reported log_cost rows stop counting.
   *
   * Explicit by design. Nothing infers this: concluding on its own that an
   * agent is Claude Code, and then silently dropping its reported spend, is
   * precisely the guess this feature exists to avoid.
   */
  router.post("/api/agents/:id/cost-observed", costObservedLimiter, (req, res) => {
    const { observed } = req.body as { observed?: unknown };
    if (typeof observed !== "boolean") {
      return res.status(400).json({ error: "observed must be true or false" });
    }

    // Read the param once and narrow it here: with a middleware in the chain
    // Express widens req.params values to string | string[].
    const id = String(req.params.id);
    const agent = setAgentCostObserved(db, id, observed);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    broadcast({ type: "agent_registered", payload: agent });
    return res.json(agent);
  });
```

Import `setAgentCostObserved` from `../db/index.js` alongside the file's existing agent imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/agents-cost-observed.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/routes/agents.ts tests/agents-cost-observed.test.ts
git commit -m "feat(api): add the endpoint to mark an agent cost-observed"
```

---

### Task 5: Make `log_cost` rows attributable

**Files:**
- Modify: `server/mcp/tools.ts` (`handleLogCost`, around line 262)
- Test: `tests/mcp-log-cost-agent.test.ts` (create)

**Interfaces:**
- Consumes: `touchAgent(db, name): Agent` from `server/db/agents.ts`, already used by `autoLog` in the same file.
- Produces: no new exports. `log_cost` gains the same auto-registration behaviour `log_activity` already has.

**Why this task exists.** `log_cost` takes `agent_id` as optional and `handleLogCost` ignores the per-session `agentName` its handler signature already receives. A caller supplying neither writes a cost row attached to no agent, and an agent-level exclusion can never touch it, because the condition deliberately skips rows with no agent. Without this task the feature has a hole that only appears for one caller shape.

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-log-cost-agent.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { getAgentByName } from "../server/db/index.js";
import { handleTool } from "../server/mcp/tools.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const args = {
  model: "claude-opus-5", provider: "anthropic",
  input_tokens: 10, output_tokens: 10, cost_usd: 1,
};

describe("log_cost agent attribution", () => {
  it("attaches the session agent when agent_id is omitted", async () => {
    await handleTool(db, "log_cost", { ...args }, "claude");

    const agent = getAgentByName(db, "claude");
    expect(agent).not.toBeNull();

    const row = db.prepare(`SELECT agent_id FROM cost_entries`).get() as { agent_id: string | null };
    expect(row.agent_id).toBe(agent!.id);
  });

  it("prefers an explicit agent_id over the session name", async () => {
    await handleTool(db, "log_cost", { ...args }, "session-agent");
    const sessionAgent = getAgentByName(db, "session-agent")!;

    await handleTool(db, "log_cost", { ...args, agent_id: sessionAgent.id }, "someone-else");

    const rows = db.prepare(`SELECT agent_id FROM cost_entries`).all() as { agent_id: string | null }[];
    expect(rows.every((r) => r.agent_id === sessionAgent.id)).toBe(true);
  });

  it("still writes the row when there is no agent_id and no session name", async () => {
    // The documented limitation: unattributable, so unexcludable, but never lost.
    await handleTool(db, "log_cost", { ...args });

    const row = db.prepare(`SELECT agent_id, cost_usd FROM cost_entries`).get() as
      { agent_id: string | null; cost_usd: number };
    expect(row.agent_id).toBeNull();
    expect(row.cost_usd).toBeCloseTo(1, 10);
  });
});
```

If `getAgentByName`'s signature differs from `getAgentByName(db, name)`, read `server/db/agents.ts:66` and use the real one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mcp-log-cost-agent.test.ts`
Expected: FAIL on the first case. The row's `agent_id` is `null` because the session name is ignored.

- [ ] **Step 3: Thread the session agent through**

In `server/mcp/tools.ts`, change `handleLogCost` to accept the session agent name and resolve it, mirroring what `autoLog` already does:

```ts
function handleLogCost(db: Database.Database, args: Args, agentName?: string): ToolResult {
  // Resolve the session agent when the caller did not name one, exactly as
  // log_activity does through autoLog. Without this a cost row can land
  // attached to no agent, and an agent-level exclusion deliberately skips
  // rows with no agent, so that spend stays double counted forever.
  let agentId = (args.agent_id as string) ?? null;
  if (!agentId && agentName) {
    agentId = touchAgent(db, agentName).id;
  }

  const entry = logCost(db, {
    agent_id: agentId,
    task_id: (args.task_id as string) ?? null,
    milestone_id: (args.milestone_id as string) ?? null,
    project_id: (args.project_id as string) ?? null,
    model: args.model as string,
    provider: args.provider as string,
    input_tokens: args.input_tokens as number,
    output_tokens: args.output_tokens as number,
    cost_usd: args.cost_usd as number,
  });
  return ok(entry);
}
```

`touchAgent` is already imported in this file for `autoLog`. If it is not, add it to the existing import from `../db/index.js`.

The `HANDLERS` entry needs no change: `Handler` is already typed `(db, args, agentName?) => ToolResult`, and `log_cost: handleLogCost` now matches that signature exactly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mcp-log-cost-agent.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS. Existing MCP tests must be unaffected; `log_cost` still accepts an explicit `agent_id` and still writes a row when nothing identifies an agent.

```bash
git add server/mcp/tools.ts tests/mcp-log-cost-agent.test.ts
git commit -m "fix(mcp): attach the session agent to log_cost rows"
```

---

### Task 6: Documentation

No code. This task exists because the previous feature shipped with documentation that contradicted it, and the upgrade advice currently in the repository is only half the fix.

**Files:**
- Modify: `docs/ingestion.md` (the "Upgrading from an earlier version" section)
- Modify: `README.md` (the MCP tools table)
- Modify: `server/db/migrator.ts` (migration 019's comment)

- [ ] **Step 1: Complete the upgrade advice**

`docs/ingestion.md` currently tells an upgrading user to remove the `log_cost` step from their per-project `CLAUDE.md`. That fixes future spend and leaves every already-recorded duplicate in place. Add the second half: mark the agent as observed, with the endpoint, and state plainly that it corrects historical rows as well as future ones and that nothing is deleted.

- [ ] **Step 2: Correct the README tool table**

`README.md` lists `log_cost` as "Record token spend". Note that it is ignored for agents marked as cost-observed, and that Claude Code cost is read from transcripts instead.

- [ ] **Step 3: Correct migration 019's comment**

It currently says the `source` column "does NOT deduplicate anything today: no query filters on source". That stops being true with Task 2. Rewrite it to say what now consumes the column, and keep the honest note that the exclusion is driven by an explicit human action rather than by inference.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS.

Confirm no stale claim survives:

```bash
grep -rn "does NOT deduplicate\|no query filters on source" server/ docs/
```

Expected: no hits.

```bash
git add README.md docs/ingestion.md server/db/migrator.ts
git commit -m "docs: explain how to correct cost already double counted"
```

---

## Final verification

Before opening the PR, run the `finish-task` skill. Beyond its checklist, confirm the spec's five success criteria:

1. With both sources active and the agent marked, cost totals match what the transcripts alone report.
2. Unmarking the agent restores the previous totals exactly.
3. `GET /api/ingest/status` reports an overlap before any total is corrected, and stops once the agent is marked.
4. No cost row is deleted at any point.
5. A fresh install with no agent marked behaves exactly as it does today, which the untouched existing cost tests demonstrate.
