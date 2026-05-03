import { describe, it, expect } from "vitest";
import {
  pad,
  hr,
  header,
  milestoneStatusColor,
  STATUS_COLOR,
  PRIORITY_COLOR,
  HEALTH_COLOR,
  formatProjectRow,
  formatMilestoneRow,
  formatTaskHeaderRow,
  formatTaskRow,
  formatAgentHeaderRow,
  formatAgentRow,
  formatStatusSummary,
  formatHelp,
  RESET,
  GREEN,
  DIM,
  YELLOW,
  RED,
  BLUE,
} from "../cli/format.js";
import type { Project, Milestone, Task, Agent, Blocker } from "../server/types.js";

// Strip ANSI escape sequences for easier assertions on plain content.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("cli/format: primitives", () => {
  it("pad: pads shorter strings to target length", () => {
    expect(pad("abc", 6)).toBe("abc   ");
    expect(pad("abc", 6).length).toBe(6);
  });

  it("pad: truncates longer strings to target length", () => {
    expect(pad("abcdefgh", 4)).toBe("abcd");
  });

  it("pad: returns input unchanged when length equals target", () => {
    expect(pad("abcd", 4)).toBe("abcd");
  });

  it("hr: produces a divider of the requested length", () => {
    expect(stripAnsi(hr(10))).toBe("──────────");
  });

  it("header: returns a non-empty string containing the title", () => {
    expect(stripAnsi(header("Hello"))).toBe("Hello");
  });
});

describe("cli/format: color maps", () => {
  it("STATUS_COLOR covers all known statuses", () => {
    expect(STATUS_COLOR.done).toBe(GREEN);
    expect(STATUS_COLOR.in_progress).toBe(BLUE);
    expect(STATUS_COLOR.blocked).toBe(RED);
    expect(STATUS_COLOR.planned).toBe(DIM);
  });

  it("PRIORITY_COLOR covers all known priorities", () => {
    expect(PRIORITY_COLOR.urgent).toBe(RED);
    expect(PRIORITY_COLOR.high).toBe(YELLOW);
    expect(PRIORITY_COLOR.medium).toBe(RESET);
    expect(PRIORITY_COLOR.low).toBe(DIM);
  });

  it("HEALTH_COLOR covers all known health states", () => {
    expect(HEALTH_COLOR.active).toBe(GREEN);
    expect(HEALTH_COLOR.idle).toBe(YELLOW);
    expect(HEALTH_COLOR.offline).toBe(DIM);
  });

  it("milestoneStatusColor: maps open/achieved and falls back otherwise", () => {
    expect(milestoneStatusColor("open")).toBe(GREEN);
    expect(milestoneStatusColor("achieved")).toBe(DIM);
    expect(milestoneStatusColor("at_risk")).toBe(YELLOW);
  });
});

describe("cli/format: row formatters", () => {
  const project: Project = {
    id: "proj-1234-5678-9abc",
    name: "Demo",
    description: "a test project",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("formatProjectRow contains name, short id, description", () => {
    const plain = stripAnsi(formatProjectRow(project));
    expect(plain).toContain("Demo");
    expect(plain).toContain("proj-123"); // 8-char slice
    expect(plain).toContain("a test project");
  });

  it("formatProjectRow tolerates null description", () => {
    const plain = stripAnsi(formatProjectRow({ ...project, description: null }));
    expect(plain).toContain("Demo");
  });

  const milestone: Milestone = {
    id: "ms-aaaa-bbbb-cccc",
    project_id: project.id,
    name: "v1",
    description: null,
    acceptance_criteria: "",
    status: "open",
    target_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("formatMilestoneRow renders status, name, short id", () => {
    const plain = stripAnsi(formatMilestoneRow(milestone));
    expect(plain).toContain("open");
    expect(plain).toContain("v1");
    expect(plain).toContain("ms-aaaa");
  });

  it("formatTaskHeaderRow contains all column labels", () => {
    const plain = stripAnsi(formatTaskHeaderRow());
    expect(plain).toContain("STATUS");
    expect(plain).toContain("PRIORITY");
    expect(plain).toContain("TITLE");
    expect(plain).toContain("DUE");
  });

  const task: Task = {
    id: "task-1",
    project_id: project.id,
    parent_task_id: null,
    milestone_id: null,
    assigned_agent_id: null,
    title: "Write tests",
    description: null,
    status: "in_progress",
    priority: "high",
    progress: 0,
    due_date: "2026-05-01",
    start_date: null,
    estimate: null,
    recurrence_rule: null,
    task_type: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("formatTaskRow includes title, status, priority, due date", () => {
    const plain = stripAnsi(formatTaskRow(task));
    expect(plain).toContain("Write tests");
    expect(plain).toContain("in_progress");
    expect(plain).toContain("high");
    expect(plain).toContain("2026-05-01");
  });

  it("formatTaskRow renders '-' for missing due date", () => {
    const plain = stripAnsi(formatTaskRow({ ...task, due_date: null }));
    expect(plain).toContain("-");
  });

  it("formatAgentHeaderRow contains expected columns", () => {
    const plain = stripAnsi(formatAgentHeaderRow());
    expect(plain).toContain("NAME");
    expect(plain).toContain("MODEL");
    expect(plain).toContain("HEALTH");
    expect(plain).toContain("LAST SEEN");
  });

  const agent: Agent = {
    id: "agent-1",
    name: "claude-opus",
    model: "opus-4.7",
    capabilities: [],
    role: "coder",
    parent_agent_id: null,
    registered_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-04-17T00:00:00Z",
  };

  it("formatAgentRow includes name, model, health and last seen", () => {
    const plain = stripAnsi(formatAgentRow(agent, "active", "4/17/2026, 12:00 AM"));
    expect(plain).toContain("claude-opus");
    expect(plain).toContain("opus-4.7");
    expect(plain).toContain("active");
    expect(plain).toContain("4/17/2026");
  });

  it("formatAgentRow renders '-' model when null", () => {
    const plain = stripAnsi(formatAgentRow({ ...agent, model: null } as Agent, "idle", "now"));
    expect(plain).toContain("-");
    expect(plain).toContain("idle");
  });
});

describe("cli/format: formatStatusSummary", () => {
  it("renders all status counts and total", () => {
    const out = stripAnsi(
      formatStatusSummary({
        projectName: "Demo",
        byStatus: { planned: 3, in_progress: 1, blocked: 0, done: 5 },
        total: 9,
        blockers: [],
      }),
    );
    expect(out).toContain("Status: Demo");
    expect(out).toContain("Planned:     3");
    expect(out).toContain("In Progress: 1");
    expect(out).toContain("Blocked:     0");
    expect(out).toContain("Done:        5");
    expect(out).toContain("Total:       9");
  });

  it("defaults missing status counts to 0", () => {
    const out = stripAnsi(
      formatStatusSummary({
        projectName: "Empty",
        byStatus: {},
        total: 0,
        blockers: [],
      }),
    );
    expect(out).toContain("Planned:     0");
    expect(out).toContain("Done:        0");
  });

  it("includes open milestone block when provided", () => {
    const out = stripAnsi(
      formatStatusSummary({
        projectName: "Demo",
        byStatus: {},
        total: 0,
        openMilestone: { name: "v1", completed_count: 2, task_count: 5, completion_pct: 40 },
        blockers: [],
      }),
    );
    expect(out).toContain("Open Milestone: v1");
    expect(out).toContain("Tasks: 2/5 done");
    expect(out).toContain("Progress: 40% completed");
  });

  it("omits milestone block when not provided", () => {
    const out = stripAnsi(
      formatStatusSummary({
        projectName: "Demo",
        byStatus: {},
        total: 0,
        blockers: [],
      }),
    );
    expect(out).not.toContain("Open Milestone");
  });

  it("renders up to 5 blocker reasons", () => {
    const mk = (i: number): Blocker => ({
      id: `b${i}`,
      task_id: `t${i}`,
      reason: `blocker-${i}`,
      reported_at: "2026-01-01T00:00:00Z",
      resolved_at: null,
    });
    const out = stripAnsi(
      formatStatusSummary({
        projectName: "Demo",
        byStatus: {},
        total: 0,
        blockers: [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), mk(7)],
      }),
    );
    expect(out).toContain("Active Blockers (7)");
    expect(out).toContain("blocker-1");
    expect(out).toContain("blocker-5");
    expect(out).not.toContain("blocker-6");
  });

  it("omits blocker section when none are active", () => {
    const out = stripAnsi(
      formatStatusSummary({
        projectName: "Demo",
        byStatus: {},
        total: 0,
        blockers: [],
      }),
    );
    expect(out).not.toContain("Active Blockers");
  });
});

describe("cli/format: formatHelp", () => {
  it("lists all commands and flags", () => {
    const out = stripAnsi(formatHelp());
    expect(out).toContain("vibe-dash");
    expect(out).toContain("list");
    expect(out).toContain("add-task");
    expect(out).toContain("status");
    expect(out).toContain("agents");
    expect(out).toContain("--db");
    expect(out).toContain("--project");
    expect(out).toContain("--priority");
    expect(out).toContain("--milestone");
  });
});
