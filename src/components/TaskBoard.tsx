import { useState, useRef, useMemo, useCallback } from "react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { TaskCard } from "./TaskCard";
import { TaskEditDrawer } from "./TaskEditDrawer";
import { STATUS_COLORS } from "../constants/colors.js";
import type { Task, Milestone, TaskStatus, Agent, Tag } from "../types";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "planned", label: "PLANNED" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "done", label: "DONE" },
];


const DONE_AGE_OFF_MS = 24 * 60 * 60 * 1000;

export function TaskBoard() {
  const { tasks, projects, milestones, selectedProjectId, selectedMilestoneId, activity, agents, tags, taskTagMap, taskDepsMap, searchQuery } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const dragTaskId = useRef<string>("");

  const filteredTasks = useMemo(() => {
    const nowMs = Date.now();
    const lower = searchQuery.toLowerCase();
    return tasks.filter((t) => {
      if (t.status === "done") {
        const completedAt = new Date(t.updated_at).getTime();
        if (nowMs - completedAt > DONE_AGE_OFF_MS) return false;
      }
      return (
        t.parent_task_id === null &&
        (selectedProjectId === null || t.project_id === selectedProjectId) &&
        (selectedMilestoneId === null || t.milestone_id === selectedMilestoneId) &&
        (!searchQuery || t.title.toLowerCase().includes(lower) || (t.description ?? "").toLowerCase().includes(lower))
      );
    });
  }, [tasks, selectedProjectId, selectedMilestoneId, searchQuery]);

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;

  const projectMilestones = useMemo(
    () => selectedProjectId ? milestones.filter((m) => m.project_id === selectedProjectId) : milestones,
    [milestones, selectedProjectId]
  );

  const handleDrop = useCallback((status: TaskStatus) => {
    const id = dragTaskId.current;
    if (!id) return;
    const currentTask = tasks.find((t) => t.id === id);
    if (currentTask?.status === status) return;
    api.updateTask(id, { status }).then((updated) => {
      dispatch({ type: "WS_EVENT", payload: { type: "task_updated", payload: updated } });
    }).catch(() => {});
  }, [tasks, api, dispatch]);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg-primary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
          {selectedProject ? (
            <>
              <span style={{ color: "var(--text-muted)" }}>Project / </span>
              <span style={{ color: "var(--accent-blue)", fontWeight: 600 }}>
                {selectedProject.name}
              </span>
            </>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>All Projects</span>
          )}
        </span>

        {/* Milestone filter */}
        {projectMilestones.length > 0 && (
          <>
            <span style={{ color: "var(--border)", fontSize: "12px" }}>|</span>
            <MilestoneFilter
              milestones={projectMilestones}
              selectedMilestoneId={selectedMilestoneId}
              onSelect={(id) => dispatch({ type: "SELECT_MILESTONE", payload: id })}
            />
          </>
        )}
      </div>

      {/* Columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "0",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {COLUMNS.map(({ key, label }) => (
          <KanbanColumn
            key={key}
            status={key}
            label={label}
            tasks={filteredTasks.filter((t) => t.status === key)}
            allTasks={tasks}
            milestones={projectMilestones}
            activity={activity}
            agents={agents}
            tags={tags}
            taskTagMap={taskTagMap}
            taskDepsMap={taskDepsMap}
            selectedProjectId={selectedProjectId}
            selectedMilestoneId={selectedMilestoneId}
            onDragStart={(id) => { dragTaskId.current = id; }}
            onDrop={() => handleDrop(key)}
            onClickTask={setEditingTask}
            onTaskCreated={(task) => {
              dispatch({ type: "WS_EVENT", payload: { type: "task_created", payload: task } });
            }}
            api={api}
          />
        ))}
      </div>

      {editingTask && (
        <TaskEditDrawer
          task={editingTask}
          onClose={() => setEditingTask(null)}
        />
      )}
    </main>
  );
}

/* ─── Milestone Filter ──────────────────────────────────────────────────── */

function MilestoneFilter({
  milestones,
  selectedMilestoneId,
  onSelect,
}: {
  milestones: Milestone[];
  selectedMilestoneId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const statusOrder: Record<string, number> = { open: 0, achieved: 1 };
  const sorted = [...milestones].sort(
    (a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
  );

  return (
    <select
      value={selectedMilestoneId ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      style={{
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        color: selectedMilestoneId ? "var(--accent-blue)" : "var(--text-secondary)",
        padding: "4px 8px",
        fontSize: "12px",
        cursor: "pointer",
        maxWidth: "250px",
      }}
    >
      <option value="">All Milestones ({milestones.length})</option>
      {sorted.map((m) => {
        const icon = m.status === "achieved" ? "\u2713" : "\u25cf";
        return (
          <option key={m.id} value={m.id}>
            {icon} {m.name}
          </option>
        );
      })}
    </select>
  );
}

/* ─── Kanban Column ──────────────────────────────────────────────────────── */

interface ColumnProps {
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
  onDragStart: (id: string) => void;
  onDrop: () => void;
  onClickTask: (task: Task) => void;
  onTaskCreated: (task: Task) => void;
  api: ReturnType<typeof useApi>;
}

function KanbanColumn({
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
  onDragStart,
  onDrop,
  onClickTask,
  onTaskCreated,
  api,
}: ColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
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

  // Group tasks by milestone when no specific milestone is selected
  const shouldGroup = selectedMilestoneId === null && milestones.length > 0;
  const milestoneGroups = shouldGroup ? groupByMilestone(tasks, milestones) : null;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={() => { setIsDragOver(false); onDrop(); }}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border)",
        background: isDragOver ? "rgba(88,166,255,0.04)" : "transparent",
        transition: "background 0.15s",
        overflow: "hidden",
      }}
    >
      {/* Column header */}
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

      {/* Tasks */}
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
              onClickTask={onClickTask}
              onDragStart={onDragStart}
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
              onClick={() => onClickTask(task)}
              onDragStart={onDragStart}
            />
          ))
        )}

        {/* Add task input */}
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

/* ─── Milestone Group ──────────────────────────────────────────────────── */

interface MilestoneGroupData {
  milestone: Milestone | null;
  tasks: Task[];
}

function groupByMilestone(tasks: Task[], milestones: Milestone[]): MilestoneGroupData[] {
  const milestoneMap = new Map<string, Milestone>();
  for (const m of milestones) milestoneMap.set(m.id, m);

  const grouped = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const key = task.milestone_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(task);
  }

  const result: MilestoneGroupData[] = [];

  // Open milestones first, then achieved
  const statusOrder: Record<string, number> = { open: 0, achieved: 1 };
  const sortedMilestones = [...milestones].sort(
    (a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
  );

  for (const milestone of sortedMilestones) {
    const milestoneTasks = grouped.get(milestone.id);
    if (milestoneTasks && milestoneTasks.length > 0) {
      result.push({ milestone, tasks: milestoneTasks });
    }
  }

  // Unassigned tasks at the end
  const unassigned = grouped.get(null);
  if (unassigned && unassigned.length > 0) {
    result.push({ milestone: null, tasks: unassigned });
  }

  return result;
}

function getBlockingCount(taskId: string, taskDepsMap: Record<string, string[]>, allTasks: Task[]): number {
  const depIds = taskDepsMap[taskId];
  if (!depIds || depIds.length === 0) return 0;
  return depIds.filter((depId) => {
    const t = allTasks.find((task) => task.id === depId);
    return t && t.status !== "done";
  }).length;
}

function resolveTaskTags(taskId: string, taskTagMap: Record<string, string[]>, tags: Tag[]): Tag[] {
  const tagIds = taskTagMap[taskId];
  if (!tagIds || tagIds.length === 0) return [];
  return tagIds.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => t !== undefined);
}

function MilestoneGroup({
  milestone,
  tasks,
  allTasks,
  activity,
  agents,
  tags,
  taskTagMap,
  taskDepsMap,
  onClickTask,
  onDragStart,
}: {
  milestone: Milestone | null;
  tasks: Task[];
  allTasks: Task[];
  activity: ReturnType<typeof useAppState>["activity"];
  agents: Agent[];
  tags: Tag[];
  taskTagMap: Record<string, string[]>;
  taskDepsMap: Record<string, string[]>;
  onClickTask: (task: Task) => void;
  onDragStart: (id: string) => void;
}) {
  const statusIcon =
    milestone?.status === "achieved" ? "\u2713" : "\u25cf";
  const statusColor =
    milestone?.status === "open"
      ? "var(--accent-green)"
      : "var(--text-muted)";

  return (
    <div style={{ marginBottom: "4px" }}>
      {/* Milestone header */}
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
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            fontWeight: 400,
          }}
        >
          ({tasks.length})
        </span>
      </div>

      {/* Milestone description (truncated) */}
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

      {/* Tasks */}
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
            onClick={() => onClickTask(task)}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </div>
  );
}
