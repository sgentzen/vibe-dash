import { TaskCard } from "../TaskCard";
import { getBlockingCount, resolveTaskTags } from "./boardHelpers";
import type { DataState } from "../../store";
import type { Task, Milestone, Agent, Tag } from "../../types";

interface MilestoneGroupProps {
  milestone: Milestone | null;
  tasks: Task[];
  allTasks: Task[];
  activity: DataState["activity"];
  agents: Agent[];
  tags: Tag[];
  taskTagMap: Record<string, string[]>;
  taskDepsMap: Record<string, string[]>;
  grabbedTaskId: string | null;
  onClickTask: (task: Task) => void;
  onDragStart: (id: string) => void;
  onGrab: (id: string) => void;
}

export function MilestoneGroup({
  milestone,
  tasks,
  allTasks,
  activity,
  agents,
  tags,
  taskTagMap,
  taskDepsMap,
  grabbedTaskId,
  onClickTask,
  onDragStart,
  onGrab,
}: MilestoneGroupProps) {
  const statusIcon = milestone?.status === "achieved" ? "\u2713" : "\u25cf";
  const statusColor =
    milestone?.status === "open"
      ? "var(--status-success)"
      : "var(--text-muted)";

  return (
    <div style={{ marginBottom: "4px" }}>
      <div
        style={{
          padding: "6px 8px",
          fontSize: "11px",
          fontWeight: 600,
          color: statusColor,
          display: "flex",
          alignItems: "center",
          gap: "6px",
          borderBottom: "1px solid var(--border)",
          marginBottom: "6px",
        }}
      >
        <span>{milestone ? statusIcon : ""}</span>
        <span>{milestone ? milestone.name : "No Milestone"}</span>
        <span style={{ fontSize: "10px", color: "var(--text-muted)", fontWeight: 400 }}>
          ({tasks.length})
        </span>
      </div>

      {milestone?.description && (
        <div
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            padding: "0 8px 6px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {milestone.description.slice(0, 100)}{milestone.description.length > 100 ? "\u2026" : ""}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            allTasks={allTasks}
            activity={activity}
            agents={agents}
            taskTags={resolveTaskTags(task.id, taskTagMap, tags)}
            blockingCount={getBlockingCount(task.id, taskDepsMap, allTasks)}
            grabbed={grabbedTaskId === task.id}
            onClick={() => onClickTask(task)}
            onDragStart={onDragStart}
            onGrab={onGrab}
          />
        ))}
      </div>
    </div>
  );
}
