import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, getAgentByName, normalizeAgentName, logActivity } from "../server/db/index.js";
import { createProject, createTask } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("normalizeAgentName", () => {
  it("lowercases", () => {
    expect(normalizeAgentName("Claude")).toBe("claude");
  });

  it("trims whitespace", () => {
    expect(normalizeAgentName("  claude  ")).toBe("claude");
  });

  it("replaces underscores with spaces", () => {
    expect(normalizeAgentName("claude_code")).toBe("claude code");
  });

  it("replaces hyphens with spaces", () => {
    expect(normalizeAgentName("claude-code")).toBe("claude code");
  });

  it("collapses repeated separators", () => {
    expect(normalizeAgentName("claude__code")).toBe("claude code");
    expect(normalizeAgentName("claude--code")).toBe("claude code");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeAgentName("claude  code")).toBe("claude code");
  });

  it("treats all variants as equal", () => {
    const variants = ["Claude", "claude", "CLAUDE", "claude_code", "Claude Code", "  claude-code  "];
    const normalized = variants.map(normalizeAgentName);
    const unique = new Set(normalized);
    // "Claude", "claude", "CLAUDE" → "claude"
    // "claude_code", "claude-code", "Claude Code", "  claude-code  " → "claude code"
    expect(unique.size).toBe(2);
  });
});

describe("registerAgent deduplication", () => {
  it("Claude and claude resolve to one row", () => {
    registerAgent(db, { name: "Claude", model: null, capabilities: [] });
    registerAgent(db, { name: "claude", model: null, capabilities: [] });
    const rows = db.prepare("SELECT * FROM agents").all();
    expect(rows).toHaveLength(1);
  });

  it("claude_code and Claude Code collapse to one row", () => {
    registerAgent(db, { name: "claude_code", model: null, capabilities: [] });
    registerAgent(db, { name: "Claude Code", model: null, capabilities: [] });
    const rows = db.prepare("SELECT * FROM agents").all();
    expect(rows).toHaveLength(1);
  });

  it("preserves display name from first registration", () => {
    const first = registerAgent(db, { name: "Claude Code", model: null, capabilities: [] });
    registerAgent(db, { name: "claude_code", model: null, capabilities: [] });
    const rows = db.prepare("SELECT * FROM agents").all() as { name: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(first.name);
  });

  it("getAgentByName finds agent via any variant", () => {
    registerAgent(db, { name: "Claude Code", model: null, capabilities: [] });
    const found = getAgentByName(db, "claude_code");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Claude Code");
  });

  it("registerAgent updates last_seen_at on survivor", () => {
    const a1 = registerAgent(db, { name: "Claude", model: null, capabilities: [] });
    const a2 = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    expect(a2.id).toBe(a1.id);
    expect(a2.last_seen_at >= a1.last_seen_at).toBe(true);
  });

  it("activity count preserved across variant registrations", () => {
    const project = createProject(db, { name: "test-project", description: "" });
    const task = createTask(db, {
      title: "test task",
      project_id: project.id,
      priority: "medium",
      status: "in_progress",
    });
    const agent = registerAgent(db, { name: "Claude", model: null, capabilities: [] });
    logActivity(db, { agent_id: agent.id, task_id: task.id, message: "working" });
    logActivity(db, { agent_id: agent.id, task_id: task.id, message: "done" });

    // Re-register with different casing
    const same = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    expect(same.id).toBe(agent.id);

    const rows = db.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE agent_id = ?").get(agent.id) as { c: number };
    expect(rows.c).toBe(2);
  });
});
