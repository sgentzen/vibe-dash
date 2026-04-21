import type { Task, Milestone, Project, Agent } from "../../types";
import { DAY_MS } from "./constants";

export interface AgentLane {
  agentId: string | null;
  agentName: string;
  tasks: Task[];
}

export interface TaskGroup {
  key: string;
  label: string;
  sublabel: string | null;
  completedCount: number;
  totalCount: number;
  tasks: Task[];
}

export type SwimRow =
  | { kind: "project"; project: Project; totalCount: number; completedCount: number }
  | { kind: "milestone"; milestone: Milestone }
  | { kind: "agent"; agentId: string | null; agentName: string; projectId: string; tasks: Task[] };

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

export function buildSwimRows(
  tasks: Task[],
  milestones: Milestone[],
  projects: Project[],
  agents: Agent[],
): SwimRow[] {
  const agentMap = new Map<string, Agent>(agents.map((a) => [a.id, a]));

  // Group tasks by project
  const tasksByProject = new Map<string, Task[]>();
  for (const t of tasks) {
    const pid = t.project_id ?? "__none__";
    const arr = tasksByProject.get(pid) ?? [];
    arr.push(t);
    tasksByProject.set(pid, arr);
  }

  // Milestones by project
  const milestonesByProject = new Map<string, Milestone[]>();
  for (const m of milestones) {
    const pid = m.project_id ?? "__none__";
    const arr = milestonesByProject.get(pid) ?? [];
    arr.push(m);
    milestonesByProject.set(pid, arr);
  }

  const rows: SwimRow[] = [];

  // Emit rows in projects array order
  for (const project of projects) {
    const projectTasks = tasksByProject.get(project.id) ?? [];
    if (projectTasks.length === 0 && !(milestonesByProject.get(project.id)?.length)) continue;

    const completedCount = projectTasks.filter((t) => t.status === "done").length;
    rows.push({ kind: "project", project, totalCount: projectTasks.length, completedCount });

    // Milestone bars for this project (sorted by target_date)
    const projectMilestones = (milestonesByProject.get(project.id) ?? [])
      .filter((m) => m.target_date)
      .sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""));
    for (const m of projectMilestones) {
      rows.push({ kind: "milestone", milestone: m });
    }

    // Group tasks by agent within this project
    const tasksByAgent = new Map<string, Task[]>();
    for (const t of projectTasks) {
      const key = t.assigned_agent_id ?? "__unassigned__";
      const arr = tasksByAgent.get(key) ?? [];
      arr.push(t);
      tasksByAgent.set(key, arr);
    }

    // Sort agents by name; unassigned last
    const agentEntries = [...tasksByAgent.entries()].sort(([aId], [bId]) => {
      if (aId === "__unassigned__") return 1;
      if (bId === "__unassigned__") return -1;
      const aName = agentMap.get(aId)?.name ?? aId;
      const bName = agentMap.get(bId)?.name ?? bId;
      return aName.localeCompare(bName);
    });

    for (const [agentKey, agentTasks] of agentEntries) {
      const agent = agentKey !== "__unassigned__" ? agentMap.get(agentKey) : null;
      const agentName = agent?.name ?? (agentKey !== "__unassigned__" ? agentKey.slice(0, 8) : "Unassigned");
      rows.push({
        kind: "agent",
        agentId: agentKey !== "__unassigned__" ? agentKey : null,
        agentName,
        projectId: project.id,
        tasks: agentTasks,
      });
    }
  }

  return rows;
}

// Keep for backward compat (GroupHeaderRow still uses TaskGroup)
export function buildGroups(
  tasks: Task[],
  milestoneMap: Map<string, Milestone>,
  projectMap: Map<string, Project>,
): TaskGroup[] {
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
