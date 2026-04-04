import { useState, useEffect } from "react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { inputStyle as sharedInputStyle, sectionHeader } from "../styles/shared.js";
import type { Task, TaskStatus, TaskPriority, Tag, TaskComment } from "../types";

interface TaskEditDrawerProps {
  task: Task;
  onClose: () => void;
}

export function TaskEditDrawer({ task, onClose }: TaskEditDrawerProps) {
  const { sprints, agents, tags, taskTagMap } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [progress, setProgress] = useState(task.progress);
  const [sprintId, setSprintId] = useState<string | null>(task.sprint_id);
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(task.assigned_agent_id);
  const [dueDate, setDueDate] = useState<string>(task.due_date ?? "");
  const [estimate, setEstimate] = useState<string>(task.estimate != null ? String(task.estimate) : "");
  const [startDate, setStartDate] = useState<string>(task.start_date ?? "");
  const [recurrenceRule, setRecurrenceRule] = useState<string>(task.recurrence_rule ?? "");
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");

  function submitComment() {
    const text = newComment.trim();
    if (!text) return;
    api.addComment(task.id, text, "User").then((c) => {
      setComments((prev) => [...prev, c]);
      setNewComment("");
    }).catch(() => {});
  }

  const taskSprints = sprints.filter((s) => s.project_id === task.project_id);
  const projectTags = tags.filter((t) => t.project_id === task.project_id);
  const currentTagIds = taskTagMap[task.id] ?? [];
  const currentTags = currentTagIds.map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  const availableTags = projectTags.filter((t) => !currentTagIds.includes(t.id));

  // Keep local state fresh if task changes externally
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setProgress(task.progress);
    setSprintId(task.sprint_id);
    setAssignedAgentId(task.assigned_agent_id);
    setDueDate(task.due_date ?? "");
    setEstimate(task.estimate != null ? String(task.estimate) : "");
    setStartDate(task.start_date ?? "");
    setRecurrenceRule(task.recurrence_rule ?? "");
    setNewComment("");
    api.getComments(task.id).then(setComments).catch(() => {});
  }, [task, api]);

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
        assigned_agent_id: assignedAgentId,
        due_date: dueDate || null,
        start_date: startDate || null,
        estimate: estimate ? parseInt(estimate, 10) : null,
        recurrence_rule: recurrenceRule || null,
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

        {/* Assigned Agent */}
        {agents.length > 0 && (
          <div>
            <label style={labelStyle}>Assigned Agent</label>
            <select
              value={assignedAgentId ?? ""}
              onChange={(e) => setAssignedAgentId(e.target.value || null)}
              style={inputStyle}
            >
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Due Date */}
        <div>
          <label style={labelStyle}>Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Estimate */}
        <div>
          <label style={labelStyle}>Estimate (story points)</label>
          <input
            type="number"
            min={0}
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </div>

        {/* Start Date */}
        <div>
          <label style={labelStyle}>Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Recurrence */}
        <div>
          <label style={labelStyle}>Recurrence Rule</label>
          <select
            value={recurrenceRule}
            onChange={(e) => setRecurrenceRule(e.target.value)}
            style={inputStyle}
          >
            <option value="">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        {/* Tags */}
        <div>
          <label style={labelStyle}>Tags</label>
          {currentTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
              {currentTags.map((tag) => (
                <span
                  key={tag.id}
                  style={{
                    fontSize: "11px",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: `${tag.color}20`,
                    color: tag.color,
                    border: `1px solid ${tag.color}40`,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  {tag.name}
                  <button
                    onClick={async () => {
                      await api.removeTagFromTask(task.id, tag.id);
                      dispatch({
                        type: "WS_EVENT",
                        payload: { type: "tag_removed", payload: { id: "", task_id: task.id, tag_id: tag.id } },
                      });
                    }}
                    style={{
                      background: "none", border: "none", color: tag.color,
                      cursor: "pointer", padding: "0", fontSize: "13px", lineHeight: 1,
                    }}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
          {availableTags.length > 0 && (
            <select
              value=""
              onChange={async (e) => {
                const tagId = e.target.value;
                if (!tagId) return;
                const taskTag = await api.addTagToTask(task.id, tagId);
                dispatch({
                  type: "WS_EVENT",
                  payload: { type: "tag_added", payload: taskTag },
                });
              }}
              style={inputStyle}
            >
              <option value="">Add tag...</option>
              {availableTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          )}
          {projectTags.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: "11px", fontStyle: "italic" }}>
              No tags in this project yet
            </div>
          )}
        </div>

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

        {/* Comments */}
        <div>
          <label style={labelStyle}>Comments ({comments.length})</label>
          <div style={{
            maxHeight: "200px", overflowY: "auto",
            border: "1px solid var(--border)", borderRadius: "6px",
            marginBottom: "8px",
          }}>
            {comments.length === 0 ? (
              <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: "12px", textAlign: "center" }}>
                No comments yet
              </div>
            ) : (
              comments.map((c) => (
                <div key={c.id} style={{
                  padding: "8px 10px", borderBottom: "1px solid var(--border)",
                  fontSize: "12px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{c.author_name}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-secondary)" }}>{c.message}</div>
                </div>
              ))
            )}
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitComment(); }}
              placeholder="Add a comment..."
              style={inputStyle}
            />
            <button
              onClick={submitComment}
              disabled={!newComment.trim()}
              style={{
                background: "transparent",
                border: "1px solid var(--accent-blue)",
                color: "var(--accent-blue)",
                borderRadius: "6px",
                padding: "4px 12px",
                fontSize: "12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Send
            </button>
          </div>
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

const labelStyle: React.CSSProperties = { ...sectionHeader, display: "block", marginBottom: "5px" };

const inputStyle: React.CSSProperties = sharedInputStyle;
