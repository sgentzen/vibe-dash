# Cost Identity Re-key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make marking an agent as cost-observed actually stick across sessions, and stop the two ways the resulting numbers can still mislead.

**Architecture:** The agent row stays per-connection, because two concurrent Claude Code windows genuinely are two agents. The mark moves to the client name, which is stable, recorded at registration rather than guessed from the agent name afterwards. Two reporting corrections ride along: agent-scoped cost queries report how many rows were suppressed instead of silently showing $0.00, and the overlap report covers rows that carry no project.

**Tech Stack:** TypeScript (ESM, explicit `.js` extensions), better-sqlite3 with raw SQL, Express 5 route factories, Vitest integration tests against a real in-memory database.

## Global Constraints

Copied from the spec amendment and the repository's CLAUDE.md. Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-10-observed-cost-exclusion-design.md`, **section 14 in particular**. Section 14 supersedes D3 and section 5. Read section 14 before Task 1.
- **No ORM.** Raw SQL with better-sqlite3 prepared statements.
- **All DB functions take `db: Database.Database` as the first parameter.**
- **Timestamps** are ISO 8601 strings via `new Date().toISOString()`.
- **Imports:** ESM with explicit `.js` extensions on relative imports.
- **Naming:** PascalCase types, camelCase functions, snake_case DB columns and tables.
- **Error responses** are `{ error: "message" }` with an appropriate status. Mutation endpoints broadcast a WebSocket event and are rate limited.
- **Tests** live in `tests/`, named `*.test.ts`, get a fresh in-memory DB via `createTestDb()` from `./setup.js` in a `beforeEach`, and are integration style against a real database with no mocking. The HTTP helper is `requestApp(app, method, path, body)` returning `{ status, body }`; it is not supertest.
- **Style:** Australian English in prose and documents. No em-dashes there, no emojis anywhere. Code comments follow the surrounding repository convention, which does use em-dashes.
- **The system never guesses.** No stem-stripping heuristic, no propagating a mark to an agent by name resemblance. Section 14.2 rejects both explicitly.
- **No cost row is ever deleted.** Exclusion happens at query time only.
- **The gate before any completing commit** is the `finish-task` skill.

### Why migration 021 is edited in place

Migration 021 has never run against any database, including the developer's own (verified: `agents` has no `cost_observed_externally` column). There is nothing deployed to migrate, so amending 021 is correct and a corrective 022 would be ceremony. Do not add a 022.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db/migrator.ts` (modify) | Migration 021, rewritten: `agents.client_name` plus the `cost_observed_identities` table |
| `server/db/agents.ts` (modify) | `agentCostIdentity`, `setAgentCostObserved` re-keyed, `client_name` on registration, derived flag on every agent read |
| `server/db/helpers.ts` (modify) | `parseAgent` coerces the derived flag |
| `server/db/costs.ts` (modify) | `observedDuplicateSql` as the positive predicate, `excludeObservedCondition` derived from it, `excluded_entries` on agent-scoped queries |
| `server/mcp/server.ts` (modify) | Pass the client name through at registration |
| `server/ingest/transcripts/sync.ts` (modify) | Overlap report covers project-less rows and exposes the identity |
| `server/routes/agents.ts` (modify) | Response reports the identity that was marked |
| `shared/types.ts` (modify) | `Agent.client_name`, `CostSummary.excluded_entries`, `CostByAgentEntry.excluded_entries`, `CostOverlap` shape change |
| `tests/cost-identity.test.ts` (create) | Identity resolution, marking, and persistence across re-registration |
| `tests/observed-cost.test.ts` (modify) | Existing exclusion tests, updated for the identity key |
| `tests/cost-excluded-entries.test.ts` (create) | The suppressed-row counts |
| `tests/ingest-overlaps.test.ts` (modify) | Project-less overlap coverage |

---

### Task 1: The identity data model

**Files:**
- Modify: `server/db/migrator.ts` (rewrite migration `021_agent_cost_observed` in place, around line 765)
- Modify: `server/db/agents.ts`
- Modify: `server/db/helpers.ts` (`parseAgent`, line 16)
- Modify: `shared/types.ts`
- Test: `tests/cost-identity.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Column `agents.client_name TEXT` (nullable).
  - Table `cost_observed_identities (identity TEXT PRIMARY KEY NOT NULL, marked_at TEXT NOT NULL)`.
  - `function agentCostIdentity(agent: Pick<Agent, "client_name" | "name">): string`
  - `function setAgentCostObserved(db, agentId, observed): Agent | null` — same signature as before, re-keyed internally.
  - `function isCostObservedIdentity(db, identity: string): boolean`
  - `Agent.client_name: string | null`. `Agent.cost_observed_externally` stays a `number`, now derived.

- [ ] **Step 1: Write the failing test**

Create `tests/cost-identity.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  getAgentById,
  getAgentByName,
  listAgents,
  setAgentCostObserved,
  agentCostIdentity,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

describe("agentCostIdentity", () => {
  it("is the client name when one was recorded", () => {
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4",
      model: null,
      capabilities: [],
      client_name: "claude-code",
    });
    expect(agentCostIdentity(agent)).toBe("claude-code");
  });

  it("falls back to the agent's own name when no client name was recorded", () => {
    // Agents that named themselves through register_agent or log_activity
    // already had a stable name, so one rule covers both cases.
    const agent = registerAgent(db, { name: "cursor-bot", model: null, capabilities: [] });
    expect(agentCostIdentity(agent)).toBe("cursor-bot");
  });
});

describe("marking by identity", () => {
  it("defaults to unmarked so an upgrade changes no existing total", () => {
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("marks and unmarks", () => {
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });

    expect(setAgentCostObserved(db, agent.id, true)!.cost_observed_externally).toBe(1);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);

    expect(setAgentCostObserved(db, agent.id, false)!.cost_observed_externally).toBe(0);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("returns null for an agent that does not exist", () => {
    expect(setAgentCostObserved(db, "no-such-agent", true)).toBeNull();
  });

  it("covers a LATER connection of the same client, which is the whole point", () => {
    // This is the defect the amendment exists to fix. Each MCP connection
    // registers a new agent row with a fresh random suffix, so a mark tied to
    // one row silently stopped applying the next time the client started.
    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);

    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });

    expect(tuesday.id).not.toBe(monday.id);
    expect(getAgentById(db, tuesday.id)!.cost_observed_externally).toBe(1);
  });

  it("does not touch a different client", () => {
    const claude = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    const cursor = registerAgent(db, {
      name: "cursor-1234abcd", model: null, capabilities: [], client_name: "cursor",
    });
    setAgentCostObserved(db, claude.id, true);

    expect(getAgentById(db, cursor.id)!.cost_observed_externally).toBe(0);
  });

  it("unmarking one connection unmarks the client, including its other rows", () => {
    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);
    expect(getAgentById(db, tuesday.id)!.cost_observed_externally).toBe(1);

    setAgentCostObserved(db, tuesday.id, false);
    expect(getAgentById(db, monday.id)!.cost_observed_externally).toBe(0);
  });

  it("survives re-registration of the same agent row", () => {
    // registerAgent updates on a normalised-name match rather than inserting.
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, agent.id, true);

    const again = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: "claude-opus-5", capabilities: [], client_name: "claude-code",
    });
    expect(again.id).toBe(agent.id);
    expect(again.cost_observed_externally).toBe(1);
  });

  it("still lets a different tool inherit the mark by reusing the exact name", () => {
    // A known limitation, pinned so it stays deliberate. registerAgent updates
    // on a normalised-name match, so a second tool registering under a marked
    // agent's exact name is the SAME row and inherits the suppression of its
    // genuine, non-duplicated spend. Keying on the client narrows this (it no
    // longer catches every agent whose name merely resembles a marked one) but
    // does not remove it. Section 14.5 of the design records it.
    const first = registerAgent(db, { name: "shared-name", model: null, capabilities: [] });
    setAgentCostObserved(db, first.id, true);

    const second = registerAgent(db, { name: "shared-name", model: "other-tool/2.0", capabilities: [] });
    expect(second.id).toBe(first.id);
    expect(second.cost_observed_externally).toBe(1);
  });

  it("reports the flag from every agent read path", () => {
    // parseAgent spreads the row, so a read query that forgets the derived
    // column would silently report 0 for a marked agent. This pins all of them.
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, agent.id, true);

    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);
    expect(getAgentByName(db, "claude-code-a1b2c3d4")!.cost_observed_externally).toBe(1);
    expect(listAgents(db).find((a) => a.id === agent.id)!.cost_observed_externally).toBe(1);
  });
});
```

If `listAgents` or `getAgentByName` have signatures other than `(db)` and `(db, name)`, read `server/db/agents.ts:50-77` and use the real ones. Do not change production code to fit the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cost-identity.test.ts`
Expected: FAIL. `agentCostIdentity` is not exported and `client_name` is not an accepted input.

- [ ] **Step 3: Rewrite migration 021**

Replace the whole `021_agent_cost_observed` entry in `server/db/migrator.ts` with:

```ts
  {
    name: "021_agent_cost_observed",
    run(db) {
      // Marks a CLIENT whose spend we already read from its transcripts, so its
      // self-reported log_cost rows are duplicates rather than new spend.
      // Excluded at query time in server/db/costs.ts; the rows are never
      // deleted, because destroying money records to fix a reporting bug
      // removes the audit trail that makes the fix checkable.
      //
      // Keyed to the client rather than to a row in `agents` because agent
      // identity is per-connection: server/mcp/server.ts names each connection
      // `${clientName}-${suffix}` with a random suffix, so a mark on one row
      // stopped applying the next time the client started. See section 14 of
      // the design.
      //
      // `client_name` is recorded at registration rather than recovered later
      // by stripping the suffix. Stripping would work on rows written before
      // this change, which is its appeal, but it is a guess and it is wrong for
      // an agent legitimately named that way. This feature does not guess.
      const cols = db.pragma("table_info(agents)") as { name: string }[];
      const has = (name: string): boolean => cols.some((c) => c.name === name);
      if (!has("client_name")) {
        db.prepare("ALTER TABLE agents ADD COLUMN client_name TEXT").run();
      }

      // NOT NULL is spelled out: SQLite permits NULLs in a non-INTEGER PRIMARY
      // KEY, and a NULL identity would make the IN test below behave oddly.
      db.exec(`
        CREATE TABLE IF NOT EXISTS cost_observed_identities (
          identity  TEXT PRIMARY KEY NOT NULL,
          marked_at TEXT NOT NULL
        )
      `);
    },
  },
```

The table starts empty, so this migration moves no existing total on its own. Nothing populates it automatically.

- [ ] **Step 4: Update the shared types**

In `shared/types.ts`, in the `Agent` interface, replace the existing `cost_observed_externally` block with:

```ts
  /**
   * The MCP client this agent connected as, or null for an agent that named
   * itself through register_agent or log_activity.
   *
   * Recorded so the cost-observed mark can key on something stable. Each MCP
   * connection registers a fresh agent row with a random suffix, so the row is
   * not a durable identity and the client name is.
   */
  client_name: string | null;
  /**
   * 1 when this agent's spend is already read from its transcripts, so its
   * log_cost rows are duplicates and are excluded from cost totals.
   *
   * Derived, not stored: it is true when this agent's cost identity appears in
   * cost_observed_identities. A number rather than a boolean because SQLite has
   * no boolean type and this project uses raw SQL with no ORM layer to map it.
   */
  cost_observed_externally: number;
```

- [ ] **Step 5: Add the identity helper and the derived-flag fragment**

In `server/db/agents.ts`, add near the top, after the imports:

```ts
/**
 * The stable thing a cost-observed mark attaches to.
 *
 * An MCP connection registers as `${clientName}-${suffix}` with a fresh random
 * suffix each launch, so the agent row is not durable and the client name is.
 * An agent that named itself has no client name and was already stable, so it
 * is its own identity. One rule, no special case.
 */
export function agentCostIdentity(agent: Pick<Agent, "client_name" | "name">): string {
  return agent.client_name ?? agent.name;
}

/**
 * SQL computing the derived cost-observed flag for a row of `agents`.
 *
 * Every query that reads agents must select this, because parseAgent spreads
 * the row and a missing column would silently report an unmarked agent. The
 * test "reports the flag from every agent read path" is what enforces it.
 */
export const costObservedSql = (prefix = ""): string =>
  `CASE WHEN COALESCE(${prefix}client_name, ${prefix}name) IN ` +
  `(SELECT identity FROM cost_observed_identities) THEN 1 ELSE 0 END AS cost_observed_externally`;
```

- [ ] **Step 6: Add `client_name` to registration**

In `server/db/agents.ts`, extend `RegisterAgentInput` (line 17):

```ts
export interface RegisterAgentInput {
  name: string;
  model: string | null;
  capabilities: string[];
  role?: Agent["role"];
  parent_agent_name?: string;
  client_name?: string | null;
}
```

In `registerAgent`, add `client_name` to both branches. In the UPDATE branch use `COALESCE(?, client_name)` so a later call that omits it does not erase a recorded client name; in the INSERT branch pass `input.client_name ?? null`. Both statements end in `RETURNING *`, which will not include the derived column, so change each to `RETURNING *, (${costObservedSql()})`. Note `costObservedSql()` already ends in `AS cost_observed_externally`, so it needs no extra alias.

If wrapping the fragment in parentheses causes a syntax error with the trailing alias, select it unparenthesised instead: `RETURNING *, ${costObservedSql()}`.

- [ ] **Step 7: Add the derived column to every agent read**

In `server/db/agents.ts`, every query that reads `agents` and feeds `parseAgent` must select the fragment. That is `listAgents` (line ~50), `getAgentByName` (line ~66), `getAgentById` (line 78), and both `registerAgent` statements from Step 6. For example `getAgentById` becomes:

```ts
export function getAgentById(db: Database.Database, id: string): Agent | null {
  const row = db
    .prepare(`SELECT *, ${costObservedSql()} FROM agents WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseAgent(row);
}
```

Read each of the others and apply the same change. Where a query aliases the table (for example `FROM agents a`), pass the prefix: `costObservedSql("a.")`.

- [ ] **Step 8: Make `parseAgent` coerce the flag**

In `server/db/helpers.ts`, in `parseAgent` (line 16), add to the returned object:

```ts
    client_name: (row.client_name as string) ?? null,
    // Derived by costObservedSql(). Coerced rather than trusted so a read query
    // that omitted the fragment produces a definite 0 instead of undefined
    // leaking into the API response as a missing field.
    cost_observed_externally: Number(row.cost_observed_externally ?? 0),
```

- [ ] **Step 9: Re-key the setter**

In `server/db/agents.ts`, replace the body of `setAgentCostObserved` (line ~98), keeping its exported signature:

```ts
/**
 * Mark or unmark the CLIENT this agent belongs to as already observed through
 * its transcripts.
 *
 * Takes an agent id because that is what a user has in front of them, but acts
 * on the agent's cost identity, so the mark covers every past and future
 * connection of the same client rather than one session's row.
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
  const agent = getAgentById(db, agentId);
  if (!agent) return null;

  const identity = agentCostIdentity(agent);
  if (observed) {
    db.prepare(
      "INSERT OR IGNORE INTO cost_observed_identities (identity, marked_at) VALUES (?, ?)"
    ).run(identity, now());
  } else {
    db.prepare("DELETE FROM cost_observed_identities WHERE identity = ?").run(identity);
  }
  return getAgentById(db, agentId);
}

/** Whether a cost identity is currently marked. Used by the route's response. */
export function isCostObservedIdentity(db: Database.Database, identity: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM cost_observed_identities WHERE identity = ?")
    .get(identity);
  return row !== undefined;
}
```

Export `agentCostIdentity`, `costObservedSql` and `isCostObservedIdentity` from `server/db/index.ts` alongside the other agent exports.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run tests/cost-identity.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 11: Run the gate**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: `tests/observed-cost.test.ts` FAILS, because its exclusion condition still reads the dropped `cost_observed_externally` column. That is expected and Task 3 fixes it. Everything else must pass. If any OTHER test fails, stop and report it rather than editing the test.

- [ ] **Step 12: Commit**

```bash
git add server/db/migrator.ts server/db/agents.ts server/db/helpers.ts server/db/index.ts shared/types.ts tests/cost-identity.test.ts
git commit -m "feat(agents): key the cost-observed mark to the client, not the agent row"
```

---

### Task 2: Record the client name at MCP registration

**Files:**
- Modify: `server/mcp/server.ts` (the `oninitialized` handler, around line 33)
- Test: `tests/cost-identity.test.ts` (extend)

**Interfaces:**
- Consumes: `RegisterAgentInput.client_name` from Task 1.
- Produces: no new exports. Agents registered through an MCP connection carry their client name.

**Why this task exists.** Task 1 built the mechanism but nothing populates `client_name`, so every MCP agent still falls back to its suffixed name and the re-key changes nothing in practice. This is the task that makes it real.

- [ ] **Step 1: Write the failing test**

Append to `tests/cost-identity.test.ts`:

```ts
describe("MCP registration records the client name", () => {
  it("stores the client name separately from the suffixed agent name", () => {
    // server.ts builds `${info.name}-${suffix}`. It holds both halves before
    // joining them, so the client name is recorded rather than recovered later.
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4",
      model: "claude-code/1.0",
      capabilities: [],
      client_name: "claude-code",
    });
    expect(agent.client_name).toBe("claude-code");
    expect(agent.name).toBe("claude-code-a1b2c3d4");
  });

  it("keeps a recorded client name when a later call omits it", () => {
    // touchAgent and other paths re-register by name without knowing the
    // client. Losing the client name there would silently unmark the agent.
    registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    const again = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [],
    });
    expect(again.client_name).toBe("claude-code");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cost-identity.test.ts -t "client name"`
Expected: The second test FAILS if Step 6 of Task 1 did not use `COALESCE`. If both already pass because Task 1 was implemented correctly, say so in your report and continue: these pin behaviour Task 1 introduced, and Step 3 below is still required.

- [ ] **Step 3: Pass the client name through**

In `server/mcp/server.ts`, inside `oninitialized`, the code already computes `agentName = \`${info.name}-${suffix}\``. Add the client name to the `registerAgent` call:

```ts
      agentName = `${info.name}-${suffix}`;
      const agent = registerAgent(db, {
        name: agentName,
        model: info.version ? `${info.name}/${info.version}` : null,
        capabilities: [],
        // Recorded so a cost-observed mark can key on something stable. The
        // suffix above makes every connection a new agent row, so the row is
        // not a durable identity and info.name is.
        client_name: info.name,
      });
```

Change nothing else in this file. In particular, do not remove the suffix: two concurrent clients genuinely are two agents, which is why the suffix exists.

- [ ] **Step 4: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS except `tests/observed-cost.test.ts`, still failing from Task 1 for the reason given there.

```bash
git add server/mcp/server.ts tests/cost-identity.test.ts
git commit -m "feat(mcp): record the connecting client name on the agent"
```

---

### Task 3: Re-key the exclusion condition

**Files:**
- Modify: `server/db/costs.ts` (the fragments at lines 32-56)
- Modify: `tests/observed-cost.test.ts`
- Modify: `server/ingest/transcripts/sync.ts` only if it fails to compile

**Interfaces:**
- Consumes: the `cost_observed_identities` table and `agents.client_name` from Task 1.
- Produces:
  - `export const observedDuplicateSql = (prefix?: string): string` — the positive predicate.
  - `export const excludeObservedCondition = (prefix?: string): string` — unchanged name and signature, now `NOT (observedDuplicateSql(prefix))`.

- [ ] **Step 1: Update the existing tests to the new key**

`tests/observed-cost.test.ts` currently marks agents and asserts totals. Its assertions stay correct; only the fixture changes, because marking is now keyed by identity. Read the file and, for each agent it registers whose marking behaviour is under test, leave the call as it is: an agent with no `client_name` has itself as its identity, so every existing test remains valid unchanged.

Then ADD this test to the file, which is the one that fails without the re-key:

```ts
  it("excludes a later connection of a marked client", () => {
    // The mark must follow the client, not one session's agent row.
    const project = createProject(db, { name: "demo", description: null });
    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);

    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('m1', ?, ?, 'claude-opus-5', 'anthropic', 1, 1, 5, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
    ).run(tuesday.id, project.id);

    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBe(0);
    expect(getGlobalCostSummary(db).total_cost_usd).toBe(0);
  });
```

Add any imports this needs (`createProject`, `getProjectCostSummary`, `getGlobalCostSummary`) to the file's existing import block rather than adding a second one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/observed-cost.test.ts`
Expected: FAIL. The condition still references the dropped `cost_observed_externally` column, so SQLite raises `no such column`.

- [ ] **Step 3: Split the predicate and re-key it**

In `server/db/costs.ts`, replace the `excludeObservedCondition` definition (line ~52) with the pair below, keeping the existing doc comment above it and extending it as shown:

```ts
/**
 * Rows an observed client self-reported, which duplicate what we already read
 * from its transcripts.
 *
 * Only `mcp` rows match: the `transcript` row is the observation we trust, and
 * dropping it would delete the very figure that replaced the duplicate. A row
 * with a NULL agent_id never matches either, because a self-report that named
 * no agent cannot be attributed to one — that is the documented limitation.
 *
 * The `agent_id IS NOT NULL` guard is load-bearing and must not be removed as
 * redundant. `NULL IN (<non-empty subquery>)` evaluates to NULL, not FALSE, so
 * without it `NOT (... AND NULL)` is NULL, a WHERE clause treats that as
 * not-true, and every self-report that named no agent would vanish from the
 * totals as soon as any client was marked. Those rows are unattributable and
 * so cannot be excluded; they must stay counted.
 *
 * Resolved through the agent's cost identity, not through a flag on the agent
 * row: every MCP connection registers a new agent, so a row-level mark stopped
 * applying the next time the client started. See section 14 of the design.
 *
 * Stated positively, and the exclusion derived from it below, so a query can
 * either drop these rows or COUNT them without the two definitions drifting.
 */
export const observedDuplicateSql = (prefix = ""): string =>
  `(${prefix}source = 'mcp' ` +
  `AND ${prefix}agent_id IS NOT NULL ` +
  `AND ${prefix}agent_id IN (` +
  `SELECT a.id FROM agents a WHERE COALESCE(a.client_name, a.name) IN ` +
  `(SELECT identity FROM cost_observed_identities)))`;

/**
 * The exclusion applied by every query that reads cost_entries.
 *
 * A named constant rather than a string repeated at six call sites, so a query
 * added later cannot silently reintroduce double counting.
 */
export const excludeObservedCondition = (prefix = ""): string =>
  `NOT ${observedDuplicateSql(prefix)}`;
```

`withExclusion` and all six call sites need no change: they consume `excludeObservedCondition`, whose name and signature are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/observed-cost.test.ts tests/cost-identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS, all suites. `server/ingest/transcripts/sync.ts` imports `excludeObservedCondition`, whose signature is unchanged, so it should need no edit. If it fails to compile, fix the import rather than duplicating the SQL.

- [ ] **Step 6: Commit**

```bash
git add server/db/costs.ts tests/observed-cost.test.ts
git commit -m "feat(costs): resolve the exclusion through the agent's cost identity"
```

---

### Task 4: Report what was suppressed instead of showing $0.00

**Files:**
- Modify: `server/db/costs.ts` (`getCostSummaryBy` at line 103, `getCostByAgent` at line 217)
- Modify: `shared/types.ts`
- Test: `tests/cost-excluded-entries.test.ts` (create)

**Interfaces:**
- Consumes: `observedDuplicateSql` from Task 3.
- Produces: `CostSummary.excluded_entries: number` and `CostByAgentEntry.excluded_entries: number`.

**Why this task exists.** Transcript rows are inserted with `agent_id NULL` (`server/ingest/transcripts/sync.ts:137`), so once a client is marked, `getAgentCostSummary` reports `$0.00` and `getCostByAgent` drops the agent from the list entirely. The heaviest spender in the system reads as free, indistinguishable from an idle agent. The spend is not lost, it is counted globally against the transcript rows, but nothing at the agent level says so.

Only the agent-scoped queries change. Global, timeseries and by-model scopes keep filtering in the `WHERE` clause, because there the suppressed rows are genuinely not part of the answer and surfacing empty groups would be noise.

- [ ] **Step 1: Write the failing test**

Create `tests/cost-excluded-entries.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  setAgentCostObserved,
  getAgentCostSummary,
  getCostByAgent,
  getGlobalCostSummary,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

function addMcpCost(db: Database.Database, id: string, agentId: string, cost: number): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, ?, NULL, 'claude-opus-5', 'anthropic', 10, 10, ?, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
  ).run(id, agentId, cost);
}

describe("excluded_entries", () => {
  it("is zero when nothing is marked", () => {
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(5);
    expect(summary.excluded_entries).toBe(0);
  });

  it("reports definite zeroes for an agent with no cost rows at all", () => {
    // Conditional aggregation replaced COUNT(*) with SUM(CASE ...), and SUM
    // over zero rows is NULL where COUNT(*) was 0. This query has no GROUP BY,
    // so an empty scope still returns one row and every count must be COALESCEd
    // or the API reports null for a field typed as a number.
    const agent = registerAgent(db, { name: "idle", model: null, capabilities: [] });

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.entry_count).toBe(0);
    expect(summary.unpriced_entries).toBe(0);
    expect(summary.excluded_entries).toBe(0);
  });

  it("counts the suppressed rows once the client is marked", () => {
    // The total honestly drops to 0, and excluded_entries is what stops that
    // reading as "this agent cost nothing".
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);
    addMcpCost(db, "m2", agent.id, 7);
    setAgentCostObserved(db, agent.id, true);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.entry_count).toBe(0);
    expect(summary.excluded_entries).toBe(2);
  });

  it("keeps a fully suppressed agent in the by-agent breakdown", () => {
    // Before this, GROUP BY produced no group at all and the agent vanished
    // from the list, which reads as "never spent anything".
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);
    setAgentCostObserved(db, agent.id, true);

    const row = getCostByAgent(db).find((r) => r.agent_id === agent.id);
    expect(row).toBeDefined();
    expect(row!.total_cost_usd).toBe(0);
    expect(row!.entry_count).toBe(0);
    expect(row!.excluded_entries).toBe(1);
  });

  it("leaves an unmarked agent's row untouched", () => {
    const marked = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    const other = registerAgent(db, { name: "cursor-bot", model: null, capabilities: [] });
    addMcpCost(db, "m1", marked.id, 5);
    addMcpCost(db, "m2", other.id, 3);
    setAgentCostObserved(db, marked.id, true);

    const row = getCostByAgent(db).find((r) => r.agent_id === other.id);
    expect(row!.total_cost_usd).toBe(3);
    expect(row!.entry_count).toBe(1);
    expect(row!.excluded_entries).toBe(0);
  });

  it("does not change the global total's shape", () => {
    // Global scope keeps filtering in WHERE: the suppressed rows are simply not
    // part of that answer.
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);
    setAgentCostObserved(db, agent.id, true);

    expect(getGlobalCostSummary(db).total_cost_usd).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cost-excluded-entries.test.ts`
Expected: FAIL. `excluded_entries` is undefined.

- [ ] **Step 3: Add the fields to the shared types**

In `shared/types.ts`, add to `CostSummary`, after `unpriced_entries`:

```ts
  /**
   * Rows in this scope suppressed as duplicates of an observed client's
   * transcripts, so they contributed nothing to the total.
   *
   * Above zero means the total is not this scope's whole spend: the money is
   * counted globally against the transcript rows instead. Transcript rows carry
   * no agent_id, so without this an observed agent's own summary reads $0.00
   * and looks identical to an agent that never did anything.
   */
  excluded_entries: number;
```

Add the same field, with a one-line version of that comment, to `CostByAgentEntry`.

- [ ] **Step 4: Switch the agent-scoped queries to conditional aggregation**

In `server/db/costs.ts`, replace `getCostSummaryBy` (line 103) with:

```ts
function getCostSummaryBy(db: Database.Database, column: CostSummaryColumn, value: string): CostSummary {
  // Conditional aggregation rather than a WHERE filter, so the suppressed rows
  // can still be counted. observedDuplicateSql is never NULL — its
  // agent_id IS NOT NULL guard makes the predicate definite — so the CASE
  // arms are exhaustive.
  // Every count is COALESCEd. This query has no GROUP BY, so a scope matching
  // no rows at all still returns one row, and SUM over zero rows is NULL where
  // the COUNT(*) it replaces was 0. Without the COALESCE, an agent with no cost
  // rows would report entry_count: null and the field's type would be a lie.
  const dup = observedDuplicateSql();
  return db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN NOT ${dup} THEN cost_usd END), 0) AS total_cost_usd,
            COALESCE(SUM(CASE WHEN NOT ${dup} THEN input_tokens END), 0) AS total_input_tokens,
            COALESCE(SUM(CASE WHEN NOT ${dup} THEN output_tokens END), 0) AS total_output_tokens,
            COALESCE(SUM(CASE WHEN NOT ${dup} THEN 1 ELSE 0 END), 0) AS entry_count,
            COALESCE(SUM(CASE WHEN NOT ${dup} AND cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced_entries,
            COALESCE(SUM(CASE WHEN ${dup} THEN 1 ELSE 0 END), 0) AS excluded_entries
     FROM cost_entries WHERE ${column} = ?`
  ).get(value) as CostSummary;
}
```

`getAgentCostSummary`, `getMilestoneCostSummary` and `getProjectCostSummary` all delegate here and need no change.

Then replace `getCostByAgent` (line 217) with:

```ts
export function getCostByAgent(
  db: Database.Database,
  filter: { project_id?: string; milestone_id?: string } = {}
): CostByAgentEntry[] {
  // The exclusion is NOT in the WHERE clause here. Filtering it there removed
  // an observed agent's only rows, GROUP BY produced no group, and the agent
  // disappeared from the breakdown as though it had never spent anything.
  const dup = observedDuplicateSql("c.");
  const conditions: string[] = ["c.agent_id IS NOT NULL"];
  const params: unknown[] = [];

  if (filter.project_id) { conditions.push("c.project_id = ?"); params.push(filter.project_id); }
  if (filter.milestone_id) { conditions.push("c.milestone_id = ?"); params.push(filter.milestone_id); }

  const where = "WHERE " + conditions.join(" AND ");

  return db.prepare(
    `SELECT c.agent_id, a.name AS agent_name,
            COALESCE(SUM(CASE WHEN NOT ${dup} THEN c.cost_usd END), 0) AS total_cost_usd,
            COALESCE(SUM(CASE WHEN NOT ${dup} THEN c.input_tokens + c.output_tokens END), 0) AS total_tokens,
            SUM(CASE WHEN NOT ${dup} THEN 1 ELSE 0 END) AS entry_count,
            SUM(CASE WHEN NOT ${dup} AND c.cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_entries,
            SUM(CASE WHEN ${dup} THEN 1 ELSE 0 END) AS excluded_entries
     FROM cost_entries c
     JOIN agents a ON c.agent_id = a.id
     ${where}
     GROUP BY c.agent_id, a.name
     ORDER BY total_cost_usd DESC`
  ).all(...params) as CostByAgentEntry[];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/cost-excluded-entries.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS. Existing cost tests must be unaffected: with nothing marked, `dup` is false for every row, so each `CASE WHEN NOT dup` arm covers everything and every total is what it was. If an existing total moves, the conditional aggregation is wrong.

- [ ] **Step 7: Commit**

```bash
git add server/db/costs.ts shared/types.ts tests/cost-excluded-entries.test.ts
git commit -m "feat(costs): report suppressed rows so an observed agent is not shown as free"
```

---

### Task 5: Cover project-less rows in the overlap report

**Files:**
- Modify: `server/ingest/transcripts/sync.ts` (`getIngestStatus`, the overlap query)
- Modify: `shared/types.ts` (`CostOverlap`)
- Test: `tests/ingest-overlaps.test.ts` (extend)

**Interfaces:**
- Consumes: `excludeObservedCondition` from Task 3, `agentCostIdentity` from Task 1.
- Produces: `CostOverlap.project_id: string | null`, and a new `mcp_identities: string[]`.

**Why this task exists.** The overlap query requires `project_id IS NOT NULL` and inner-joins `projects`. `log_cost` takes an optional `project_id` and Task 5 of the previous plan attached an agent, not a project. So an `mcp` row with no project, paired with an unattributed transcript row, is invisible to the report while being fully counted by `getGlobalCostSummary` and `getSpendToday`. `docs/ingestion.md` presents an entry vanishing from `overlaps` as confirmation the correction took effect, which for those rows confirms nothing.

Reporting them under an "Unattributed" bucket matches how ingestion already names the same condition elsewhere, rather than inventing a second vocabulary.

- [ ] **Step 1: Write the failing test**

Append to `tests/ingest-overlaps.test.ts`:

```ts
describe("overlaps with no project", () => {
  it("reports a project-less mcp row against an unattributed transcript row", () => {
    // Both sides carry no project. Previously invisible to the report while
    // counting fully in the global total, so a user was told the correction
    // had taken effect when it had not.
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addCost(db, { id: "m1", project: null, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: null, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.project_id).toBeNull();
    expect(overlap.project_name).toBe("Unattributed");
    expect(overlap.mcp_entries).toBe(1);
    expect(overlap.transcript_entries).toBe(1);
  });

  it("keeps the unattributed bucket separate from a real project", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });
    addCost(db, { id: "m2", project: null, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t2", project: null, source: "transcript", day: "2026-08-10" });

    const { overlaps } = getIngestStatus(db);
    expect(overlaps).toHaveLength(2);
    expect(overlaps.filter((o) => o.project_id === null)).toHaveLength(1);
    expect(overlaps.filter((o) => o.project_id === project.id)).toHaveLength(1);
  });

  it("names the identity to mark, not just the per-session agent name", () => {
    // The suffixed agent name is not what a user marks, so reporting only that
    // tells them to act on something that will not stay marked.
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_agent_names).toEqual(["claude-code-a1b2c3d4"]);
    expect(overlap.mcp_identities).toEqual(["claude-code"]);
  });
});
```

The existing `addCost` helper in this file takes `project: string`. Widen its `opts.project` parameter to `string | null` and pass it through unchanged; the column is already nullable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ingest-overlaps.test.ts`
Expected: FAIL. The project-less rows produce no overlap entry, and `mcp_identities` is undefined.

- [ ] **Step 3: Update the shared type**

In `shared/types.ts`, update `CostOverlap`:

```ts
export interface CostOverlap {
  /** Null for spend that matched no project. Reported rather than hidden. */
  project_id: string | null;
  /** "Unattributed" when project_id is null, matching how ingestion already names this state. */
  project_name: string;
  date: string;
  mcp_entries: number;
  transcript_entries: number;
  /** Per-session agent names on the mcp side. Empty for a self-report that named no agent. */
  mcp_agent_names: string[];
  /** The cost identities behind those agents. This is what a user actually marks. */
  mcp_identities: string[];
}
```

- [ ] **Step 4: Update the query**

In `server/ingest/transcripts/sync.ts`, change the overlap query's `JOIN projects` to a `LEFT JOIN`, drop the `WHERE c.project_id IS NOT NULL` clause, group NULL project ids into one bucket, and select the identity list. The `OverlapRow` interface gains `project_id: string | null` and `mcp_identities: string | null`:

```ts
  const rows = db.prepare(`
    SELECT c.project_id                                             AS project_id,
           COALESCE(p.name, 'Unattributed')                          AS project_name,
           DATE(c.created_at)                                        AS date,
           SUM(CASE WHEN c.source = 'mcp' THEN 1 ELSE 0 END)         AS mcp_entries,
           SUM(CASE WHEN c.source = 'transcript' THEN 1 ELSE 0 END)  AS transcript_entries,
           GROUP_CONCAT(DISTINCT a.name)                             AS mcp_agent_names,
           GROUP_CONCAT(DISTINCT COALESCE(a.client_name, a.name))    AS mcp_identities
      FROM cost_entries c
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN agents a ON a.id = c.agent_id
     WHERE ${excludeObservedCondition("c.")}
     GROUP BY c.project_id, project_name, DATE(c.created_at)
    HAVING mcp_entries > 0 AND transcript_entries > 0
     ORDER BY date DESC, project_name
  `).all() as OverlapRow[];
```

`GROUP BY c.project_id` groups all NULLs together in SQLite, which is what the unattributed bucket needs. Map `mcp_identities` the same way `mcp_agent_names` is already mapped, splitting on `","` and returning `[]` for NULL.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ingest-overlaps.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS. `tests/ingest-routes.test.ts` asserts status keys with `toMatchObject`, so an added field must not break it.

- [ ] **Step 7: Commit**

```bash
git add server/ingest/transcripts/sync.ts shared/types.ts tests/ingest-overlaps.test.ts
git commit -m "feat(ingest): report overlaps that carry no project, and name the identity to mark"
```

---

### Task 6: Tell the caller which identity was marked

**Files:**
- Modify: `server/routes/agents.ts` (the `cost-observed` route)
- Test: `tests/agents-cost-observed.test.ts` (extend)

**Interfaces:**
- Consumes: `agentCostIdentity` and `isCostObservedIdentity` from Task 1.
- Produces: the route's response body becomes `{ agent: Agent, identity: string, observed: boolean }`.

**Why this task exists.** A user marks one agent and silently gets coverage of every session sharing its client name. That is the intended behaviour and it is a surprise unless the response says so.

- [ ] **Step 1: Write the failing test**

Append to `tests/agents-cost-observed.test.ts`:

```ts
describe("the response names the identity", () => {
  it("reports the client name it actually marked", () => {
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });

    return request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true }).then((res) => {
      expect(res.status).toBe(200);
      const body = res.body as { identity: string; observed: boolean; agent: { cost_observed_externally: number } };
      expect(body.identity).toBe("claude-code");
      expect(body.observed).toBe(true);
      expect(body.agent.cost_observed_externally).toBe(1);
    });
  });

  it("reports the agent's own name when it has no client name", () => {
    const agent = registerAgent(db, { name: "cursor-bot", model: null, capabilities: [] });

    return request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true }).then((res) => {
      expect((res.body as { identity: string }).identity).toBe("cursor-bot");
    });
  });
});
```

The file's existing tests assert against the agent object at the top level of the body. Those assertions must be updated to read `res.body.agent` instead, since the body shape changes. Update them; do not leave them asserting the old shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/agents-cost-observed.test.ts`
Expected: FAIL. `identity` is undefined and the existing assertions now read `body.agent`.

- [ ] **Step 3: Update the route**

In `server/routes/agents.ts`, change the success path of the `cost-observed` route:

```ts
    const agent = setAgentCostObserved(db, id, observed);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Naming the identity matters: marking one agent covers every past and
    // future connection of the same client, which is the point but is a
    // surprise unless the response says which client was marked.
    const identity = agentCostIdentity(agent);
    broadcast({ type: "agent_registered", payload: agent });
    return res.json({ agent, identity, observed: isCostObservedIdentity(db, identity) });
```

Import `agentCostIdentity` and `isCostObservedIdentity` from `../db/index.js` alongside the file's existing agent imports. Leave the validation, the 404, the rate limiter and the broadcast type exactly as they are.

- [ ] **Step 4: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/routes/agents.ts tests/agents-cost-observed.test.ts
git commit -m "feat(api): name the identity the cost-observed endpoint marked"
```

---

### Task 7: Documentation

No code. The previous round of this work shipped documentation that overstated what the code did, and a reviewer caught it. The claims below are the ones this change makes false or incomplete.

**Files:**
- Modify: `docs/ingestion.md` (the "Upgrading from an earlier version" section)
- Modify: `README.md` (the MCP tools table entry for `log_cost`)
- Modify: `server/db/migrator.ts` (migration 019's comment, if it still names the old mechanism)

- [ ] **Step 1: Correct the upgrade advice**

The section currently tells the reader to mark the agent, and states the limitation about rows with no agent. Both stay. What changes:

- Marking is now keyed to the **client**, not to one agent row. Say that marking one agent covers every session of that client, past and future, and that the response names the client it marked.
- Add the limitation from section 14.3, plainly and not in a parenthetical: an agent row written **before this change** has no recorded client name, so its identity is its full suffixed name and marking it covers that one session only. Anyone upgrading with existing duplicates has one mark per past session. There is no backfill, because the only available backfill is a guess about which part of the name is the suffix, and this feature does not guess.
- Do not imply a future feature will fix it.

Verify the claim about pre-change rows against migration 021 before writing it.

- [ ] **Step 2: Correct the README tool table**

`README.md` describes `log_cost` and, from the previous round, notes it is ignored for agents marked as cost-observed. Update "agents" to the client-level truth, keeping the line short and linking to the ingestion doc as it already does.

- [ ] **Step 3: Check migration 019's comment**

The previous round rewrote it to name what consumes the `source` column. Confirm the mechanism it describes still matches the code after the re-key, and correct it if it names a flag on the agent row.

- [ ] **Step 4: Sweep for other claims this change falsified**

Search `README.md` and `docs/` for any statement that the cost-observed mark is a property of an agent, or that an agent's cost summary shows its full spend. Fix what you find, and say explicitly in your report if you find nothing.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add README.md docs/ingestion.md server/db/migrator.ts
git commit -m "docs: describe the client-level cost-observed mark and its limits"
```

---

## Final verification

Before opening the PR, run the `finish-task` skill. Beyond its checklist, confirm:

1. Marking a client corrects totals for its past sessions **and** its next one. The `tests/cost-identity.test.ts` case "covers a LATER connection of the same client" is the proof; re-read it and confirm it would fail against a row-level flag.
2. Unmarking restores the previous totals exactly.
3. An observed agent's own summary reports `total_cost_usd: 0` **with** a non-zero `excluded_entries`, and the agent still appears in `getCostByAgent`.
4. `GET /api/ingest/status` reports an overlap for spend carrying no project, and names the identity to mark rather than only the per-session agent name.
5. No cost row is deleted at any point.
6. A fresh install with nothing marked behaves exactly as it does today, which the untouched existing cost tests demonstrate.
