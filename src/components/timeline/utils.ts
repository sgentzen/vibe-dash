import type { Task, Milestone, Project } from "../../types";
import { DAY_MS } from "./constants";

export interface TaskGroup {
  key: string;
  label: string;
  sublabel: string | null;
  completedCount: number;
  totalCount: number;
  tasks: Task[];
}

export function getTaskDates(
  task: Task,
  milestoneMap: Map<string, Milestone>,
): { start: number; end: number } | null {
  const taskStart = task.start_date ? new Date(task.start_date).getTime() : null;
  const taskEnd = task.due_date ? new Date(task.due_date).getTime() : null;

  if (taskStart || taskEnd) {
    const start = taskStart ?? (taskEnd! - 7 * DAY_MS);
    const end = taskEnd ?? (taskStart! + 7 * DAY_MS);
    return { start, end };
  }

  if (task.milestone_id) {
    const milestone = milestoneMap.get(task.milestone_id);
    if (milestone && milestone.target_date) {
      const milestoneDate = new Date(milestone.target_date).getTime();
      const start = milestoneDate - 14 * DAY_MS;
      const end = milestoneDate;
      return { start, end };
    }
  }

  return null;
}

export function formatWeekLabel(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function buildGroups(
  tasks: Task[],
  milestoneMap: Map<string, Milestone>,
  projectMap: Map<string, Project>,
): TaskGroup[] {
  // Bucket tasks by milestone first, then by project for un-milestoned tasks
  const milestoneGroups = new Map<string, Task[]>();
  const projectGroups = new Map<string, Task[]>();
  const ungrouped: Task[] = [];

  for (const t of tasks) {
    if (t.milestone_id && milestoneMap.has(t.milestone_id)) {
      const arr = milestoneGroups.get(t.milestone_id) ?? [];
      arr.push(t);
      milestoneGroups.set(t.milestone_id, arr);
    } else if (t.project_id && projectMap.has(t.project_id)) {
      const arr = projectGroups.get(t.project_id) ?? [];
      arr.push(t);
      projectGroups.set(t.project_id, arr);
    } else {
      ungrouped.push(t);
    }
  }

  const groups: TaskGroup[] = [];

  // Milestone groups (sorted by target_date, then name)
  const msEntries = [...milestoneGroups.entries()].sort((a, b) => {
    const mA = milestoneMap.get(a[0])!;
    const mB = milestoneMap.get(b[0])!;
    if (mA.target_date && mB.target_date) return mA.target_date.localeCompare(mB.target_date);
    if (mA.target_date) return -1;
    if (mB.target_date) return 1;
    return mA.name.localeCompare(mB.name);
  });

  for (const [msId, msTasks] of msEntries) {
    const ms = milestoneMap.get(msId)!;
    const proj = projectMap.get(ms.project_id);
    const completed = msTasks.filter((t) => t.status === "done").length;
    groups.push({
      key: `ms-${msId}`,
      label: ms.name,
      sublabel: proj ? proj.name : null,
      completedCount: completed,
      totalCount: msTasks.length,
      tasks: msTasks,
    });
  }

  // Project groups (for tasks with no milestone)
  const projEntries = [...projectGroups.entries()].sort((a, b) => {
    const pA = projectMap.get(a[0])!;
    const pB = projectMap.get(b[0])!;
    return pA.name.localeCompare(pB.name);
  });

  for (const [projId, projTasks] of projEntries) {
    const proj = projectMap.get(projId)!;
    const completed = projTasks.filter((t) => t.status === "done").length;
    groups.push({
      key: `proj-${projId}`,
      label: proj.name,
      sublabel: "No milestone",
      completedCount: completed,
      totalCount: projTasks.length,
      tasks: projTasks,
    });
  }

  // Ungrouped
  if (ungrouped.length > 0) {
    const completed = ungrouped.filter((t) => t.status === "done").length;
    groups.push({
      key: "ungrouped",
      label: "Ungrouped",
      sublabel: null,
      completedCount: completed,
      totalCount: ungrouped.length,
      tasks: ungrouped,
    });
  }

  return groups;
}
