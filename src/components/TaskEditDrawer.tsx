import { useState, useEffect } from "react";
import FocusTrap from "focus-trap-react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { inputStyle as sharedInputStyle, sectionHeader } from "../styles/shared.js";
import type { Task, TaskStatus, TaskPriority, Tag, TaskComment } from "../types";
import { CommentsSection } from "./task/CommentsSection";

interface TaskEditDrawerProps {
  task: Task;
  onClose: () => void;
}

export function TaskEditDrawer({ task, onClose }: TaskEditDrawerProps) {
  const { milestones, agents, tags, taskTagMap } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [progress, setProgress] = useState(task.progress);
  const [milestoneId, setMilestoneId] = useState<string | null>(task.milestone_id);
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

  const taskMilestones = milestones.filter((m) => m.project_id === task.project_id);
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
    setMilestoneId(task.milestone_id);
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
        milestone_id: milestoneId,
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
    <FocusTrap focusTrapOptions={{ clickOutsideDeactivates: true, escapeDeactivates: true, onDeactivate: onClose }}>
      <div>
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
        role="dialog"
        aria-modal="true"
        aria-label="Edit task"
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
          <label htmlFor="task-title" style={labelStyle}>Title</label>
          <input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="task-description" style={labelStyle}>Description</label>
          <textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        {/* Status */}
        <div>
          <label htmlFor="task-status" style={labelStyle}>Status</label>
          <select
            id="task-status"
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
          <label htmlFor="task-priority" style={labelStyle}>Priority</label>
          <select
            id="task-priority"
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

        {/* Milestone */}
        {taskMilestones.length > 0 && (
          <div>
            <label htmlFor="task-milestone" style={labelStyle}>Milestone</label>
            <select
              id="task-milestone"
              value={milestoneId ?? ""}
              onChange={(e) => setMilestoneId(e.target.value || null)}
              style={inputStyle}
            >
              <option value="">No Milestone</option>
              {taskMilestones.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Assigned Agent */}
        {agents.length > 0 && (
          <div>
            <label htmlFor="task-agent" style={labelStyle}>Assigned Agent</label>
            <select
              id="task-agent"
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
          <label htmlFor="task-due-date" style={labelStyle}>Due Date</label>
          <input
            id="task-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Estimate */}
        <div>
          <label htmlFor="task-estimate" style={labelStyle}>Estimate (story points)</label>
          <input
            id="task-estimate"
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
          <label htmlFor="task-start-date" style={labelStyle}>Start Date</label>
          <input
            id="task-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Recurrence */}
        <div>
          <label htmlFor="task-recurrence" style={labelStyle}>Recurrence Rule</label>
          <select
            id="task-recurrence"
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
          <label htmlFor="task-tags" style={labelStyle}>Tags</label>
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
              id="task-tags"
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
          <label htmlFor="task-progress" style={labelStyle}>Progress — {progress}%</label>
          <input
            id="task-progress"
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent-green)" }}
          />
        </div>

        {/* Comments */}
        <CommentsSection
          comments={comments}
          newComment={newComment}
          onNewCommentChange={setNewComment}
          onSubmitComment={submitComment}
        />

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
      </div>
    </FocusTrap>
  );
}

const labelStyle: React.CSSProperties = { ...sectionHeader, display: "block", marginBottom: "5px" };

const inputStyle: React.CSSProperties = sharedInputStyle;
