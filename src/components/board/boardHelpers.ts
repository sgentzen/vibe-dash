import type { Task, Milestone, Tag } from "../../types";

export interface MilestoneGroupData {
  milestone: Milestone | null;
  tasks: Task[];
}

export function groupByMilestone(tasks: Task[], milestones: Milestone[]): MilestoneGroupData[] {
  const grouped = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const key = task.milestone_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(task);
  }

  const statusOrder: Record<string, number> = { open: 0, achieved: 1 };
  const sortedMilestones = [...milestones].sort(
    (a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
  );

  const result: MilestoneGroupData[] = [];
  for (const milestone of sortedMilestones) {
    const milestoneTasks = grouped.get(milestone.id);
    if (milestoneTasks && milestoneTasks.length > 0) {
      result.push({ milestone, tasks: milestoneTasks });
    }
  }

  const unassigned = grouped.get(null);
  if (unassigned && unassigned.length > 0) {
    result.push({ milestone: null, tasks: unassigned });
  }

  return result;
}

export function getBlockingCount(taskId: string, taskDepsMap: Record<string, string[]>, allTasks: Task[]): number {
  const depIds = taskDepsMap[taskId];
  if (!depIds || depIds.length === 0) return 0;
  return depIds.filter((depId) => {
    const t = allTasks.find((task) => task.id === depId);
    return t && t.status !== "done";
  }).length;
}

export function resolveTaskTags(taskId: string, taskTagMap: Record<string, string[]>, tags: Tag[]): Tag[] {
  const tagIds = taskTagMap[taskId];
  if (!tagIds || tagIds.length === 0) return [];
  return tagIds.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => t !== undefined);
}
