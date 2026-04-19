import { useState, useRef, useMemo, useCallback } from "react";
import { useAppState, useAppDispatch } from "../store";
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
      </div>

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
