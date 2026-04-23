import { useRef, useState } from "react";
import { TaskCard } from "../TaskCard";
import { MilestoneGroup } from "./MilestoneGroup";
import { groupByMilestone, getBlockingCount, resolveTaskTags } from "./boardHelpers";
import { STATUS_COLORS } from "../../constants/colors.js";
import type { useAppState } from "../../store";
import type { useApi } from "../../hooks/useApi";
import type { Task, Milestone, TaskStatus, Agent, Tag } from "../../types";

interface KanbanColumnProps {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  allTasks: Task[];
  milestones: Milestone[];
  activity: ReturnType<typeof useAppState>["activity"];
  agents: Agent[];
  tags: Tag[];
  taskTagMap: Record<string, string[]>;
  taskDepsMap: Record<string, string[]>;
  selectedProjectId: string | null;
  selectedMilestoneId: string | null;
  grabbedTaskId: string | null;
  onDragStart: (id: string) => void;
  onDrop: () => void;
  onGrab: (id: string) => void;
  onClickTask: (task: Task) => void;
  onTaskCreated: (task: Task) => void;
  api: ReturnType<typeof useApi>;
}

export function KanbanColumn({
  status,
  label,
  tasks,
  allTasks,
  milestones,
  activity,
  agents,
  tags,
  taskTagMap,
  taskDepsMap,
  selectedProjectId,
  selectedMilestoneId,
  grabbedTaskId,
  onDragStart,
  onDrop,
  onGrab,
  onClickTask,
  onTaskCreated,
  api,
}: KanbanColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const setDragOver = (on: boolean) => {
    const el = columnRef.current;
    if (!el) return;
    el.style.background = on ? "rgba(88,166,255,0.04)" : "transparent";
  };
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const canAdd = (status === "planned" || status === "in_progress") && selectedProjectId !== null;

  async function handleCreate() {
    const title = newTaskTitle.trim();
    if (!title || !selectedProjectId) return;
    setCreating(true);
    try {
      const task = await api.createTask({
        project_id: selectedProjectId,
        title,
        priority: "medium",
      });
      if (status === "in_progress") {
        const updated = await api.updateTask(task.id, { status: "in_progress" });
        onTaskCreated(updated);
      } else {
        onTaskCreated(task);
      }
      setNewTaskTitle("");
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }

  const shouldGroup = selectedMilestoneId === null && milestones.length > 0;
  const milestoneGroups = shouldGroup ? groupByMilestone(tasks, milestones) : null;

  return (
    <div
      ref={columnRef}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => { setDragOver(false); onDrop(); }}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border)",
        background: "transparent",
        transition: "background 0.15s",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: STATUS_COLORS[status],
          }}
        >
          {label}
        </span>
        <span
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "1px 8px",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          {tasks.length}
        </span>
      </div>

      <div
        className="panel-scroll"
        style={{
          flex: 1,
          padding: "10px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {milestoneGroups ? (
          milestoneGroups.map((group) => (
            <MilestoneGroup
              key={group.milestone?.id ?? "no-milestone"}
              milestone={group.milestone}
              tasks={group.tasks}
              allTasks={allTasks}
              activity={activity}
              agents={agents}
              tags={tags}
              taskTagMap={taskTagMap}
              taskDepsMap={taskDepsMap}
              grabbedTaskId={grabbedTaskId}
              onClickTask={onClickTask}
              onDragStart={onDragStart}
              onGrab={onGrab}
            />
          ))
        ) : (
          tasks.map((task) => (
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
          ))
        )}

        {canAdd && (
          <div style={{ marginTop: "4px" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                placeholder="Add task\u2026"
                aria-label={`Add task to ${label}`}
                style={{
                  flex: 1,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  padding: "5px 8px",
                  fontSize: "12px",
                }}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newTaskTitle.trim()}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text-secondary)",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
