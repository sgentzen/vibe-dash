import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useDataState, useNavigationState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { TaskEditDrawer } from "./TaskEditDrawer";
import { MilestoneFilter } from "./board/MilestoneFilter";
import { KanbanColumn } from "./board/KanbanColumn";
import type { Task, TaskStatus } from "../types";

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "planned", label: "PLANNED" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "done", label: "DONE" },
];

const DONE_AGE_OFF_MS = 24 * 60 * 60 * 1000;

type SortBy = "default" | "due_soonest";

export function TaskBoard() {
  const { tasks, projects, milestones, activity, agents, tags, taskTagMap, taskDepsMap } = useDataState();
  const { selectedProjectId, selectedMilestoneId, searchQuery } = useNavigationState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [keyboardGrab, setKeyboardGrab] = useState<{ taskId: string } | null>(null);
  const [grabError, setGrabError] = useState<string | null>(null);
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const dragTaskId = useRef<string>("");

  useEffect(() => {
    setFilterTagId(null);
  }, [selectedProjectId]);

  const projectTags = useMemo(
    () => selectedProjectId ? tags.filter((t) => t.project_id === selectedProjectId) : tags,
    [tags, selectedProjectId]
  );

  const filteredTasks = useMemo(() => {
    const nowMs = Date.now();
    const lower = searchQuery.toLowerCase();
    let result = tasks.filter((t) => {
      if (t.status === "done") {
        const completedAt = new Date(t.updated_at).getTime();
        if (nowMs - completedAt > DONE_AGE_OFF_MS) return false;
      }
      if (filterTagId) {
        const taskTags = taskTagMap[t.id] ?? [];
        if (!taskTags.includes(filterTagId)) return false;
      }
      return (
        t.parent_task_id === null &&
        (selectedProjectId === null || t.project_id === selectedProjectId) &&
        (selectedMilestoneId === null || t.milestone_id === selectedMilestoneId) &&
        (!searchQuery || t.title.toLowerCase().includes(lower) || (t.description ?? "").toLowerCase().includes(lower))
      );
    });
    return result;
  }, [tasks, selectedProjectId, selectedMilestoneId, searchQuery, filterTagId, taskTagMap]);

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

  const handleGrab = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setKeyboardGrab({ taskId });
  }, [tasks]);

  // Keep a live ref so the keydown handler always sees current tasks
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    if (!keyboardGrab) return;
    const colOrder: TaskStatus[] = ["planned", "in_progress", "done"];

    function moveToStatus(taskId: string, newStatus: TaskStatus) {
      api.updateTask(taskId, { status: newStatus }).then((updated) => {
        dispatch({ type: "WS_EVENT", payload: { type: "task_updated", payload: updated } });
      }).catch(() => {
        setGrabError("Move failed — please try again");
      });
      setKeyboardGrab(null);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!keyboardGrab) return;
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const liveTask = tasksRef.current.find((t) => t.id === keyboardGrab.taskId);
      const currentStatus = liveTask?.status ?? "planned";
      const idx = colOrder.indexOf(currentStatus);

      if (e.key === "Escape") { e.preventDefault(); setKeyboardGrab(null); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); moveToStatus(keyboardGrab.taskId, colOrder[Math.max(0, idx - 1)]); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moveToStatus(keyboardGrab.taskId, colOrder[Math.min(colOrder.length - 1, idx + 1)]); }
      else if (!inInput && e.key === "1") { e.preventDefault(); moveToStatus(keyboardGrab.taskId, "planned"); }
      else if (!inInput && e.key === "2") { e.preventDefault(); moveToStatus(keyboardGrab.taskId, "in_progress"); }
      else if (!inInput && e.key === "3") { e.preventDefault(); moveToStatus(keyboardGrab.taskId, "done"); }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keyboardGrab, api, dispatch, setGrabError]);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg-primary)",
      }}
    >
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

        {/* Tag filter */}
        {projectTags.length > 0 && (
          <>
            <span style={{ color: "var(--border)", fontSize: "12px" }}>|</span>
            <select
              value={filterTagId ?? ""}
              onChange={(e) => setFilterTagId(e.target.value || null)}
              style={{
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                color: filterTagId ? "var(--accent-blue)" : "var(--text-secondary)",
                padding: "4px 8px",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              <option value="">All Tags</option>
              {projectTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Sort */}
        <span style={{ color: "var(--border)", fontSize: "12px" }}>|</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: sortBy !== "default" ? "var(--accent-blue)" : "var(--text-secondary)",
            padding: "4px 8px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          <option value="default">Default Order</option>
          <option value="due_soonest">Due Soonest</option>
        </select>
      </div>

      {(keyboardGrab || grabError) && (
        <div
          id="keyboard-grab-bar"
          role="status"
          aria-live="polite"
          style={{
            padding: "6px 16px",
            background: grabError ? "var(--status-danger)" : "var(--accent-blue)",
            color: "#fff",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flexShrink: 0,
          }}
        >
          {grabError ? (
            <>
              <span>{grabError}</span>
              <button
                onClick={() => setGrabError(null)}
                aria-label="Dismiss error"
                style={{ marginLeft: "auto", background: "rgba(0,0,0,0.2)", border: "none", color: "#fff", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px" }}
              >
                Dismiss
              </button>
            </>
          ) : keyboardGrab ? (
            <>
              <span>Moving: <strong>{tasks.find((t) => t.id === keyboardGrab.taskId)?.title}</strong></span>
              <span style={{ opacity: 0.85 }}>← → change column · 1 Planned · 2 In Progress · 3 Done · Esc cancel</span>
              <button
                onClick={() => setKeyboardGrab(null)}
                aria-label="Cancel keyboard move"
                style={{ marginLeft: "auto", background: "rgba(0,0,0,0.2)", border: "none", color: "#fff", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px" }}
              >
                Cancel
              </button>
            </>
          ) : null}
        </div>
      )}

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
            grabbedTaskId={keyboardGrab?.taskId ?? null}
            onDragStart={(id) => { dragTaskId.current = id; }}
            onDrop={() => handleDrop(key)}
            onGrab={handleGrab}
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
