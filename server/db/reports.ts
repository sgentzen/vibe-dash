import type Database from "better-sqlite3";
import type { Project, Task, Blocker } from "../types.js";
import { listAgents, getAgentHealthStatus } from "./agents.js";
import { listSprints, getSprintCapacity } from "./sprints.js";

export function generateReport(db: Database.Database, projectId: string, period: "day" | "week" | "sprint"): string {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined;
  if (!project) return "# Report\n\nProject not found.";

  const now_ts = new Date();
  let sinceDate: string;
  if (period === "day") {
    sinceDate = new Date(now_ts.getTime() - 24 * 60 * 60 * 1000).toISOString();
  } else if (period === "week") {
    sinceDate = new Date(now_ts.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    sinceDate = new Date(now_ts.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  const completedTasks = db.prepare(
    "SELECT * FROM tasks WHERE project_id = ? AND status = 'done' AND updated_at >= ? ORDER BY updated_at DESC"
  ).all(projectId, sinceDate) as Task[];

  const blockers = db.prepare(
    "SELECT * FROM blockers WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?) AND reported_at >= ? ORDER BY reported_at DESC"
  ).all(projectId, sinceDate) as Blocker[];

  const agents = listAgents(db);
  const activeAgents = agents.filter(a => {
    const elapsed = now_ts.getTime() - new Date(a.last_seen_at).getTime();
    return elapsed < 30 * 60 * 1000;
  });

  const sprints = listSprints(db, projectId);
  const activeSprint = sprints.find(s => s.status === "active");
  let sprintSection = "";
  if (activeSprint) {
    const cap = getSprintCapacity(db, activeSprint.id);
    sprintSection = `## Sprint: ${activeSprint.name}\n- Tasks: ${cap.completed_count}/${cap.task_count} done\n- Points: ${cap.completed_points}/${cap.total_estimated} completed\n- Remaining: ${cap.remaining_points} points\n`;
  }

  const lines = [
    `# Status Report: ${project.name}`,
    `**Period:** ${period} | **Generated:** ${now_ts.toISOString().slice(0, 16)}`,
    "",
    sprintSection,
    `## Tasks Completed (${completedTasks.length})`,
    ...completedTasks.slice(0, 20).map(t => `- ${t.title}${t.estimate ? ` (${t.estimate}pt)` : ""}`),
    "",
    `## Blockers (${blockers.length})`,
    blockers.length === 0 ? "- None" : "",
    ...blockers.slice(0, 10).map(b => `- ${b.reason}${b.resolved_at ? " (resolved)" : " **unresolved**"}`),
    "",
    `## Agents (${activeAgents.length} active / ${agents.length} total)`,
    ...agents.map(a => `- ${a.name}: ${getAgentHealthStatus(a.last_seen_at)}`),
  ];

  return lines.filter(l => l !== undefined).join("\n");
}
