import type Database from "better-sqlite3";
import type { Project, Milestone, Task, Blocker, ActivityEntry, MilestoneProgress } from "../types.js";
import { listMilestones, getMilestoneProgress } from "./milestones.js";
import { listTasks } from "./tasks.js";

export interface ProjectContext {
  project: Project | null;
  open_milestones: (Milestone & { progress: MilestoneProgress })[];
  in_progress_tasks: Task[];
  active_blockers: Blocker[];
  recent_activity: ActivityEntry[];
}

const RECENT_ACTIVITY_LIMIT = 10;

export function getProjectContext(db: Database.Database, projectId: string): ProjectContext {
  const project =
    (db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined) ?? null;

  const open_milestones = listMilestones(db, projectId)
    .filter((m) => m.status === "open")
    .map((m) => ({ ...m, progress: getMilestoneProgress(db, m.id) }));

  const in_progress_tasks = listTasks(db, { project_id: projectId, status: "in_progress" });

  const active_blockers = db
    .prepare(
      "SELECT b.* FROM blockers b JOIN tasks t ON b.task_id = t.id WHERE t.project_id = ? AND b.resolved_at IS NULL ORDER BY b.reported_at DESC"
    )
    .all(projectId) as Blocker[];

  const recent_activity = db
    .prepare(
      "SELECT a.id, a.task_id, a.agent_id, a.message, a.timestamp, a.source, ag.name AS agent_name, t.title AS task_title " +
        "FROM activity_log a LEFT JOIN agents ag ON a.agent_id = ag.id JOIN tasks t ON a.task_id = t.id " +
        "WHERE t.project_id = ? ORDER BY a.timestamp DESC LIMIT ?"
    )
    .all(projectId, RECENT_ACTIVITY_LIMIT) as ActivityEntry[];

  return { project, open_milestones, in_progress_tasks, active_blockers, recent_activity };
}
