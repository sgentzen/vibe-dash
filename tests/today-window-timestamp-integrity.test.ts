import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runMigrations } from "../server/db/migrator.js";
import {
  registerAgent,
  createProject,
  createTask,
  completeTask,
  logActivity,
  getTasksCompletedToday,
  getAgentCompletedToday,
  getAgentStats,
  getSpendToday,
  getSpendTodayUnpriced,
  getCostTimeseries,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

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

/** The cutoff itself, which every window below treats as inside today. */
function todayStart(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * A task completed by `agentId`, with `updated_at` forced to `when`.
 *
 * A task's timestamps are server-generated, so an unreadable updated_at cannot
 * be produced through the public API; the column is written as the corruption
 * would leave it, after completeTask has set a real value. Cost rows are not
 * the same case — cost_entries.created_at is copied verbatim from a transcript
 * JSONL timestamp, so an undatable value reaches that column through ordinary
 * ingestion.
 */
function completedTaskAt(projectId: string, agentId: string, title: string, when: string): void {
  const task = createTask(db, { project_id: projectId, title, description: null, priority: "medium" });
  logActivity(db, { task_id: task.id, agent_id: agentId, message: "working" });
  completeTask(db, task.id);
  db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(when, task.id);
}

function addCost(id: string, cost: number | null, when: string): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, NULL, NULL, 'some-model', 'anthropic', 10, 10, ?, ?, 'transcript', ?)`
  ).run(id, cost, when, `ext-${id}`);
}

/**
 * Every "today" window compared raw ISO strings against the cutoff, which is
 * string order, not date order. `'not-a-date' >= '2026-09-18T00:00:00.000Z'` is
 * true because 'n' outranks '2', so a row carrying an unreadable timestamp was
 * counted as having happened today; `''` sorts below the cutoff and was
 * excluded, so the two bad values pulled in opposite directions. The visible
 * result was an inflated count of today's completed tasks and an inflated
 * figure for today's spend — a plausible wrong number, which is worse than a
 * visible absence.
 */
describe("getTasksCompletedToday with an unreadable updated_at", () => {
  let projectId: string;
  beforeEach(() => {
    projectId = createProject(db, { name: "P", description: null }).id;
  });

  function done(title: string, when: string): void {
    const task = createTask(db, { project_id: projectId, title, description: null, priority: "medium" });
    completeTask(db, task.id);
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(when, task.id);
  }

  it("counts a task completed today", () => {
    done("real", today());
    expect(getTasksCompletedToday(db)).toBe(1);
  });

  it("ignores a task completed yesterday", () => {
    done("old", yesterday());
    expect(getTasksCompletedToday(db)).toBe(0);
  });

  it("ignores a task whose updated_at is not a date", () => {
    done("real", today());
    done("corrupt", "not-a-date");

    expect(getTasksCompletedToday(db)).toBe(1);
  });

  it("ignores a task whose updated_at is blank", () => {
    // A blank value was already excluded, by string order rather than by
    // intent. Pinned here so the two unreadable values are known to agree.
    done("real", today());
    done("blank", "");

    expect(getTasksCompletedToday(db)).toBe(1);
  });

  it("reports zero rather than a count of the corruption when every row is unreadable", () => {
    done("corrupt", "not-a-date");
    done("blank", "");

    expect(getTasksCompletedToday(db)).toBe(0);
  });

  it("counts a task sitting exactly on the cutoff", () => {
    // The window is inclusive, and it stayed inclusive across the move from
    // string order to julianday() arithmetic — the one case where the two
    // could have diverged for a perfectly readable timestamp.
    done("boundary", todayStart());

    expect(getTasksCompletedToday(db)).toBe(1);
  });

  it("ignores a task one millisecond before the cutoff", () => {
    const justBefore = new Date(Date.parse(todayStart()) - 1).toISOString();
    done("just-missed", justBefore);

    expect(getTasksCompletedToday(db)).toBe(0);
  });
});

/** A fresh project and agent, for the two per-agent windows below. */
function newProjectAndAgent(): { projectId: string; agentId: string } {
  return {
    projectId: createProject(db, { name: "P", description: null }).id,
    agentId: registerAgent(db, { name: "worker", model: null, capabilities: [] }).id,
  };
}

describe("getAgentCompletedToday with an unreadable updated_at", () => {
  let projectId: string;
  let agentId: string;
  beforeEach(() => {
    ({ projectId, agentId } = newProjectAndAgent());
  });

  it("counts a task the agent completed today", () => {
    completedTaskAt(projectId, agentId, "real", today());
    expect(getAgentCompletedToday(db, agentId)).toBe(1);
  });

  it("ignores a task whose updated_at is not a date", () => {
    completedTaskAt(projectId, agentId, "real", today());
    completedTaskAt(projectId, agentId, "corrupt", "not-a-date");

    expect(getAgentCompletedToday(db, agentId)).toBe(1);
  });

  it("ignores a task whose updated_at is blank", () => {
    completedTaskAt(projectId, agentId, "real", today());
    completedTaskAt(projectId, agentId, "blank", "");

    expect(getAgentCompletedToday(db, agentId)).toBe(1);
  });
});

describe("getAgentStats tasks_completed_today with an unreadable updated_at", () => {
  let projectId: string;
  let agentId: string;
  beforeEach(() => {
    ({ projectId, agentId } = newProjectAndAgent());
  });

  it("keeps the undatable task out of today's count but still counts it as done", () => {
    // The row is genuinely complete; what cannot be read is when. Only the
    // window-dependent figure drops it, because tasks_completed_total asks a
    // question the timestamp is not needed to answer.
    completedTaskAt(projectId, agentId, "real", today());
    completedTaskAt(projectId, agentId, "corrupt", "not-a-date");

    const stats = getAgentStats(db, agentId);

    expect(stats.tasks_completed_today).toBe(1);
    expect(stats.tasks_completed_total).toBe(2);
  });

  it("ignores a task whose updated_at is blank", () => {
    completedTaskAt(projectId, agentId, "real", today());
    completedTaskAt(projectId, agentId, "blank", "");

    expect(getAgentStats(db, agentId).tasks_completed_today).toBe(1);
  });
});

describe("getSpendToday with an unreadable created_at", () => {
  it("sums only the rows it can place in today", () => {
    addCost("real", 5, today());
    addCost("corrupt", 100, "not-a-date");

    expect(getSpendToday(db)).toBeCloseTo(5, 10);
  });

  it("ignores a row whose created_at is blank", () => {
    addCost("real", 5, today());
    addCost("blank", 100, "");

    expect(getSpendToday(db)).toBeCloseTo(5, 10);
  });

  it("reports zero rather than the corrupt row's cost when nothing is datable", () => {
    addCost("corrupt", 100, "not-a-date");

    expect(getSpendToday(db)).toBeCloseTo(0, 10);
  });

  it("includes a row sitting exactly on the cutoff", () => {
    addCost("boundary", 5, todayStart());

    expect(getSpendToday(db)).toBeCloseTo(5, 10);
  });

  it("excludes a row one millisecond before the cutoff", () => {
    addCost("just-missed", 5, new Date(Date.parse(todayStart()) - 1).toISOString());

    expect(getSpendToday(db)).toBeCloseTo(0, 10);
  });

  it("counts a readable timestamp that sorts below the ISO cutoff as string text", () => {
    // 'YYYY-MM-DD HH:MM:SS' is a date SQLite reads fine, but as text it sorts
    // under the cutoff because ' ' (0x20) ranks below 'T' (0x54). The old
    // string window dropped it from today; date arithmetic places it correctly.
    // This is why the index is an expression index rather than a raw-column
    // prefilter bolted onto the front of the predicate — see migration 024.
    const spaced = todayStart().replace("T", " ").replace(".000Z", "");
    addCost("spaced", 5, spaced);

    expect(getSpendToday(db)).toBeCloseTo(5, 10);
  });
});

describe("getSpendTodayUnpriced with an unreadable created_at", () => {
  it("ignores an unpriced row that cannot be placed in today", () => {
    // The window has to match getSpendToday exactly, or the count explains a
    // figure the reader is not looking at.
    addCost("real", null, today());
    addCost("corrupt", null, "not-a-date");

    expect(getSpendTodayUnpriced(db)).toBe(1);
  });

  it("ignores an unpriced row whose created_at is blank", () => {
    addCost("real", null, today());
    addCost("blank", null, "");

    expect(getSpendTodayUnpriced(db)).toBe(1);
  });
});

/**
 * Regression guard rather than a fix. An unreadable created_at passed the raw
 * string window here too, but `DATE('not-a-date')` is NULL, so the row landed
 * in a NULL-date group that no day in the emitted range ever matched. The
 * exclusion was therefore real but accidental; these tests hold it while the
 * window becomes an explicit one.
 */
describe("getCostTimeseries with an unreadable created_at", () => {
  it("places the corrupt row in no bucket at all", () => {
    addCost("real", 5, today());
    addCost("corrupt", 100, "not-a-date");

    const series = getCostTimeseries(db, { days: 2 });
    const total = series.reduce((sum, row) => sum + row.total_cost_usd, 0);
    const entries = series.reduce((sum, row) => sum + row.entry_count, 0);

    expect(total).toBeCloseTo(5, 10);
    expect(entries).toBe(1);
  });

  it("places a blank created_at in no bucket either", () => {
    addCost("real", 5, today());
    addCost("blank", 100, "");

    const series = getCostTimeseries(db, { days: 2 });

    expect(series.reduce((sum, row) => sum + row.entry_count, 0)).toBe(1);
  });

  it("emits the requested range even when every row is undatable", () => {
    addCost("corrupt", 100, "not-a-date");

    const series = getCostTimeseries(db, { days: 2 });

    expect(series).toHaveLength(2);
    expect(series.every((row) => row.entry_count === 0)).toBe(true);
  });
});

/**
 * The cost windows compare julianday(created_at), which the plain column index
 * cannot serve: getSpendToday, getSpendTodayUnpriced and the unfiltered
 * getCostTimeseries each fell from an index range scan to a full scan of
 * cost_entries, on the /api/stats path the dashboard polls every 3 seconds.
 * Migration 024 adds the matching expression index.
 *
 * These tests explain the SQL the production functions actually prepare, rather
 * than a copy of it kept here. A copy would stay green through exactly the
 * rewrite worth catching — swapping the predicate for date(created_at), or
 * bolting a raw-column prefilter onto the front — while the real queries went
 * back to scanning. An index nothing uses is indistinguishable from no index.
 */
describe("the cost window stays sargable", () => {
  /** The SQL a function prepares, captured by standing in front of db.prepare. */
  function preparedBy(run: () => void): string[] {
    const captured: string[] = [];
    const real = db.prepare.bind(db);
    (db as unknown as { prepare: unknown }).prepare = (sql: string) => {
      captured.push(sql);
      return real(sql);
    };
    try {
      run();
    } finally {
      delete (db as unknown as { prepare?: unknown }).prepare;
    }
    return captured;
  }

  function planOf(sql: string): string {
    const holes = (sql.match(/\?/g) ?? []).length;
    const params = Array.from({ length: holes }, () => todayStart());
    return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
      .map((r) => r.detail)
      .join(" | ");
  }

  it("creates the expression index", () => {
    // Separate from the plan assertions: this is the guard for a later
    // cost_entries rebuild that forgets to re-create the index, the way
    // migration 020's recreate list would.
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_cost_entries_created_at_jd");

    expect(row).not.toBeUndefined();
  });

  it.each([
    ["getSpendToday", () => getSpendToday(db)],
    ["getSpendTodayUnpriced", () => getSpendTodayUnpriced(db)],
    ["getCostTimeseries", () => getCostTimeseries(db, { days: 30 })],
  ])("resolves %s through the expression index", (_name, run) => {
    // Picked by table rather than by position, so a statement added to one of
    // these functions later cannot silently retarget the assertion.
    const windowed = preparedBy(() => {
      run();
    }).filter((sql) => sql.includes("cost_entries"));

    expect(windowed).toHaveLength(1);
    const plan = planOf(windowed[0]);

    expect(plan).toContain("idx_cost_entries_created_at_jd");
    // Names the table, because the observed-duplicate subquery legitimately
    // scans `agents` in every one of these plans.
    expect(plan).not.toContain("SCAN cost_entries");
  });

  it("builds the index on a database that already holds a clock-reading timestamp", () => {
    // The failure this guards is not a wrong number, it is a database nothing
    // can open: migration 024 throwing rolls its transaction back, so the
    // migration is never recorded, initDb() throws, and the server, the stdio
    // MCP and the CLI all fail on every start. Reproduced by putting 024 back
    // in front of a row that would have broken it.
    db.prepare("DROP INDEX idx_cost_entries_created_at_jd").run();
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(
      "024_cost_entries_created_at_julianday_index"
    );
    addCost("subsec-row", 100, "subsec");

    expect(() => runMigrations(db)).not.toThrow();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_cost_entries_created_at_jd")
    ).not.toBeUndefined();
  });
});

/**
 * julianday() reads a handful of strings off the clock rather than as stored
 * dates: 'now', and 'subsec'/'subsecond' since SQLite 3.42, case-insensitively.
 * A column holding one would pass every window ending today — the original
 * fail-open bug wearing a different mask. Worse, SQLite refuses julianday() in
 * an index expression as soon as a stored value reads the clock, raising
 * "non-deterministic use of julianday() in an index" on the CREATE INDEX and on
 * every later INSERT, so with migration 024 in place one such row would leave a
 * database that nothing can open. The date-shaped whitelist in julianDaySql()
 * closes both, for every value at once rather than for an enumerated few — the
 * reason it is a whitelist is that 'now\0' defeats an exact comparison while
 * still reading the clock, and 'subsec' shows the list of words can grow.
 */
describe.each([["now"], ["NOW"], ["subsec"], ["subsecond"], ["SUBSEC"], ["now\u0000"]])(
  "a stored timestamp of %j",
  (value) => {
    it("does not stop a cost row being written", () => {
      expect(() => addCost("clock-reader", 100, value)).not.toThrow();
    });

    it("is treated as unreadable rather than as this instant", () => {
      addCost("real", 5, today());
      addCost("clock-reader", 100, value);

      expect(getSpendToday(db)).toBeCloseTo(5, 10);
    });

    it("is left out of the unpriced count as well", () => {
      // Unpriced, so the row would be counted here if the window let it in.
      // The two figures share a window by design and must agree on this row.
      addCost("clock-reader", null, value);

      expect(getSpendTodayUnpriced(db)).toBe(0);
    });

    it("keeps a task out of today's completed count", () => {
      const projectId = createProject(db, { name: "P", description: null }).id;
      const task = createTask(db, {
        project_id: projectId,
        title: "clock-reader",
        description: null,
        priority: "medium",
      });
      completeTask(db, task.id);
      db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(value, task.id);

      expect(getTasksCompletedToday(db)).toBe(0);
    });
  }
);
