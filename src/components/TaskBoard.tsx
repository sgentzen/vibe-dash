import { useState, useRef } from "react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { TaskCard } from "./TaskCard";
import { TaskEditDrawer } from "./TaskEditDrawer";
import type { Task, TaskStatus } from "../types";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "planned", label: "PLANNED" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "done", label: "DONE" },
];

const COLUMN_COLORS: Record<TaskStatus, string> = {
  planned: "var(--text-muted)",
  in_progress: "var(--accent-green)",
  done: "var(--accent-blue)",
  blocked: "var(--accent-yellow)",
};

export function TaskBoard() {
  const { tasks, projects, selectedProjectId, activity } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const dragTaskId = useRef<string>("");

  const filteredTasks = tasks.filter(
    (t) =>
      t.parent_task_id === null &&
      (selectedProjectId === null || t.project_id === selectedProjectId)
  );

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;

  function handleDrop(status: TaskStatus) {
    const id = dragTaskId.current;
    if (!id) return;
    // Skip no-op drops (same column)
    const currentTask = tasks.find((t) => t.id === id);
    if (currentTask?.status === status) return;
    api.updateTask(id, { status }).then((updated) => {
      dispatch({ type: "WS_EVENT", payload: { type: "task_updated", payload: updated } });
    }).catch(() => {});
  }

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
            activity={activity}
            selectedProjectId={selectedProjectId}
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

interface ColumnProps {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  activity: ReturnType<typeof useAppState>["activity"];
  selectedProjectId: string | null;
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
  activity,
  selectedProjectId,
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
      // If column is in_progress, immediately update status
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
            color: COLUMN_COLORS[status],
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
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            activity={activity}
            onClick={() => onClickTask(task)}
            onDragStart={onDragStart}
          />
        ))}

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
                placeholder="Add task…"
                style={{
                  flex: 1,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  color: "var(--text-primary)",
                  padding: "5px 8px",
                  fontSize: "12px",
                  outline: "none",
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
