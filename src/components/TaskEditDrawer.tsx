import { useState, useEffect } from "react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import type { Task, TaskStatus, TaskPriority } from "../types";

interface TaskEditDrawerProps {
  task: Task;
  onClose: () => void;
}

export function TaskEditDrawer({ task, onClose }: TaskEditDrawerProps) {
  const { sprints } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [progress, setProgress] = useState(task.progress);
  const [sprintId, setSprintId] = useState<string | null>(task.sprint_id);
  const [saving, setSaving] = useState(false);

  const taskSprints = sprints.filter((s) => s.project_id === task.project_id);

  // Keep local state fresh if task changes externally
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setProgress(task.progress);
    setSprintId(task.sprint_id);
  }, [task]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateTask(task.id, {
        title,
        description: description || undefined,
        status,
        priority,
        progress,
        sprint_id: sprintId,
      });
      dispatch({ type: "WS_EVENT", payload: { type: "task_updated", payload: updated } });
      onClose();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkDone() {
    setSaving(true);
    try {
      const updated = await api.completeTask(task.id);
      dispatch({ type: "WS_EVENT", payload: { type: "task_completed", payload: updated } });
      onClose();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 10,
        }}
      />

      {/* Drawer */}
      <div
        className="drawer"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "360px",
          background: "var(--bg-secondary)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          padding: "20px",
          gap: "16px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            style={{
              color: "var(--text-secondary)",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Edit Task
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "18px",
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Title */}
        <div>
          <label style={labelStyle}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        {/* Status */}
        <div>
          <label style={labelStyle}>Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            style={inputStyle}
          >
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
        </div>

        {/* Priority */}
        <div>
          <label style={labelStyle}>Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            style={inputStyle}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        {/* Sprint */}
        {taskSprints.length > 0 && (
          <div>
            <label style={labelStyle}>Sprint</label>
            <select
              value={sprintId ?? ""}
              onChange={(e) => setSprintId(e.target.value || null)}
              style={inputStyle}
            >
              <option value="">No Sprint</option>
              {taskSprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Progress */}
        <div>
          <label style={labelStyle}>Progress — {progress}%</label>
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent-green)" }}
          />
        </div>

        {/* Actions */}
        <div style={{ marginTop: "auto", display: "flex", gap: "10px" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              background: "var(--green-bg)",
              border: "1px solid var(--green-border)",
              color: "var(--accent-green)",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "13px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {task.status !== "done" && (
            <button
              onClick={handleMarkDone}
              disabled={saving}
              style={{
                flex: 1,
                background: "transparent",
                border: "1px solid var(--accent-green)",
                color: "var(--accent-green)",
                borderRadius: "6px",
                padding: "8px",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Mark Done
            </button>
          )}
        </div>
      </div>
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "var(--text-muted)",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "5px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text-primary)",
  padding: "7px 10px",
  fontSize: "13px",
  outline: "none",
};
