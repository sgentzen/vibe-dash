/**
 * M6-T1d: Milestone health four-quadrant coverage.
 *
 * Tests both the pure helper (computeMilestoneHealth) and the integration path
 * (getExecutiveSummary → getMilestoneHealth) so the bug-fix is anchored end-to-end.
 *
 * See docs/decisions/milestone-health-formula.md for the rationale behind cases.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createProject,
  createMilestone,
  createTask,
  completeTask,
  getExecutiveSummary,
} from "../server/db/index.js";
import { computeMilestoneHealth } from "../server/db/milestone-health.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

/** Force a milestone's created_at to a specific ISO timestamp (vs. the default `now()`). */
function setMilestoneCreatedAt(milestoneId: string, isoTs: string): void {
  db.prepare("UPDATE milestones SET created_at = ? WHERE id = ?").run(isoTs, milestoneId);
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function dateOffset(days: number): string {
  return dayOffset(days).slice(0, 10);
}

// ─── Pure helper ──────────────────────────────────────────────────────────────

describe("computeMilestoneHealth (pure)", () => {
  const NOW = new Date("2026-05-03T12:00:00Z");

  it("returns on_track when progress >= 1 regardless of dates", () => {
    expect(computeMilestoneHealth({
      progress: 1,
      created_at: "2026-04-01T00:00:00Z",
      target_date: "2026-04-15",
      now: NOW,
    })).toBe("on_track");
  });

  it("returns at_risk when there is no target_date and progress < 1 (primary bug fix)", () => {
    expect(computeMilestoneHealth({
      progress: 0,
      created_at: "2026-04-01T00:00:00Z",
      target_date: null,
      now: NOW,
    })).toBe("at_risk");

    expect(computeMilestoneHealth({
      progress: 0.99,
      created_at: "2026-04-01T00:00:00Z",
      target_date: null,
      now: NOW,
    })).toBe("at_risk");
  });

  it("returns on_track when no target_date but progress = 1", () => {
    expect(computeMilestoneHealth({
      progress: 1,
      created_at: "2026-04-01T00:00:00Z",
      target_date: null,
      now: NOW,
    })).toBe("on_track");
  });

  it("returns behind when past target_date with incomplete progress", () => {
    expect(computeMilestoneHealth({
      progress: 0.5,
      created_at: "2026-04-01T00:00:00Z",
      target_date: "2026-04-15",
      now: NOW,
    })).toBe("behind");
  });

  it("returns on_track when progress is well ahead of elapsed time", () => {
    // 10% elapsed, 80% complete → delta +0.70
    expect(computeMilestoneHealth({
      progress: 0.8,
      created_at: "2026-05-01T00:00:00Z",
      target_date: "2026-09-30",
      now: new Date("2026-05-15T00:00:00Z"),
    })).toBe("on_track");
  });

  it("returns at_risk when delta is in [-0.30, -0.15)", () => {
    // 50% elapsed, 30% complete → delta -0.20
    expect(computeMilestoneHealth({
      progress: 0.3,
      created_at: "2026-04-01T00:00:00Z",
      target_date: "2026-06-01",
      now: new Date("2026-05-01T12:00:00Z"),
    })).toBe("at_risk");
  });

  it("returns behind when delta < -0.30", () => {
    // ~50% elapsed, 10% complete → delta -0.40
    expect(computeMilestoneHealth({
      progress: 0.1,
      created_at: "2026-04-01T00:00:00Z",
      target_date: "2026-06-01",
      now: new Date("2026-05-01T12:00:00Z"),
    })).toBe("behind");
  });

  it("treats past target_date as behind even when window is degenerate", () => {
    // now > target_date short-circuits before the span check
    expect(computeMilestoneHealth({
      progress: 0.5,
      created_at: "2026-05-15T00:00:00Z",
      target_date: "2026-05-10",
      now: new Date("2026-05-12T00:00:00Z"),
    })).toBe("behind");
  });

  it("returns at_risk when window is degenerate (target ≤ created) and we are still before target", () => {
    // target ≤ created, now ≤ target → exercises the span <= 0 early return
    expect(computeMilestoneHealth({
      progress: 0.5,
      created_at: "2026-05-15T00:00:00Z",
      target_date: "2026-05-10",
      now: new Date("2026-05-08T00:00:00Z"),
    })).toBe("at_risk");
  });
});

// ─── Integration via getExecutiveSummary ─────────────────────────────────────

describe("getMilestoneHealth via getExecutiveSummary", () => {
  function makeMilestone(opts: {
    name: string;
    target_date: string | null;
    created_at?: string;
    totalTasks: number;
    doneTasks: number;
  }): string {
    const project = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string } | undefined;
    const projectId = project?.id ?? createProject(db, { name: "test-proj", description: null }).id;

    const ms = createMilestone(db, {
      project_id: projectId,
      name: opts.name,
      target_date: opts.target_date,
    });
    if (opts.created_at) setMilestoneCreatedAt(ms.id, opts.created_at);

    for (let i = 0; i < opts.totalTasks; i++) {
      const t = createTask(db, {
        project_id: projectId,
        title: `${opts.name} task ${i}`,
        milestone_id: ms.id,
        priority: "medium",
      });
      if (i < opts.doneTasks) completeTask(db, t.id);
    }
    return projectId;
  }

  function healthFor(name: string, projectId: string): string {
    const summary = getExecutiveSummary(db, projectId);
    const m = summary?.milestone_health.find((x) => x.name === name);
    if (!m) throw new Error(`milestone '${name}' not found in summary`);
    return m.health;
  }

  it("(1) progress >> elapsed → on_track", () => {
    const pid = makeMilestone({
      name: "ahead",
      created_at: dayOffset(-10),
      target_date: dateOffset(+90),
      totalTasks: 10,
      doneTasks: 9,
    });
    expect(healthFor("ahead", pid)).toBe("on_track");
  });

  it("(2) progress slightly behind elapsed → at_risk", () => {
    // ~50% elapsed, 30% done → delta -0.20
    const pid = makeMilestone({
      name: "slow",
      created_at: dayOffset(-30),
      target_date: dateOffset(+30),
      totalTasks: 10,
      doneTasks: 3,
    });
    expect(healthFor("slow", pid)).toBe("at_risk");
  });

  it("(3) progress far behind elapsed → behind", () => {
    // ~75% elapsed, 10% done → delta -0.65
    const pid = makeMilestone({
      name: "stalled",
      created_at: dayOffset(-45),
      target_date: dateOffset(+15),
      totalTasks: 10,
      doneTasks: 1,
    });
    expect(healthFor("stalled", pid)).toBe("behind");
  });

  it("(4) past target_date with incomplete tasks → behind", () => {
    const pid = makeMilestone({
      name: "overdue",
      created_at: dayOffset(-30),
      target_date: dateOffset(-2),
      totalTasks: 5,
      doneTasks: 2,
    });
    expect(healthFor("overdue", pid)).toBe("behind");
  });

  it("(5) past target_date but complete → on_track", () => {
    const pid = makeMilestone({
      name: "late-but-done",
      created_at: dayOffset(-30),
      target_date: dateOffset(-2),
      totalTasks: 3,
      doneTasks: 3,
    });
    expect(healthFor("late-but-done", pid)).toBe("on_track");
  });

  it("(6) no target_date with progress < 1 → at_risk (BUG FIX coverage)", () => {
    const pid = makeMilestone({
      name: "undated-incomplete",
      target_date: null,
      totalTasks: 4,
      doneTasks: 0,
    });
    expect(healthFor("undated-incomplete", pid)).toBe("at_risk");
  });

  it("(7) no target_date with progress = 1 → on_track", () => {
    const pid = makeMilestone({
      name: "undated-done",
      target_date: null,
      totalTasks: 2,
      doneTasks: 2,
    });
    expect(healthFor("undated-done", pid)).toBe("on_track");
  });
});
