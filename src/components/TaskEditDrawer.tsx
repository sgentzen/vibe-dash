import { useState, useEffect } from "react";
import FocusTrap from "focus-trap-react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { inputStyle as sharedInputStyle } from "../styles/shared.js";
import type { Task, TaskStatus, TaskPriority, Tag, TaskComment, AgentSuggestion } from "../types";
import { CommentsSection } from "./task/CommentsSection";
import { TagPicker } from "./task/TagPicker";
import { ModalBackdrop } from "./ui/ModalBackdrop";
import { ModalDrawer } from "./ui/ModalDrawer";
import { FormField } from "./ui/FormField";
import { TaskDrawerHeader } from "./task-edit/TaskDrawerHeader";
import { TaskMetadataFields } from "./task-edit/TaskMetadataFields";
import { TaskDateFields } from "./task-edit/TaskDateFields";
import { TaskDrawerActions } from "./task-edit/TaskDrawerActions";

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
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);

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
    api.getSuggestedAgent(task.id).then(setSuggestion).catch(() => setSuggestion(null));
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
      <ModalBackdrop onClick={onClose} />
      <ModalDrawer ariaLabel="Edit task">
        <TaskDrawerHeader onClose={onClose} />

        <FormField id="task-title" label="Title">
          <input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </FormField>

        <FormField id="task-description" label="Description">
          <textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </FormField>

        <TaskMetadataFields
          status={status}
          onStatusChange={setStatus}
          priority={priority}
          onPriorityChange={setPriority}
          milestoneId={milestoneId}
          onMilestoneChange={setMilestoneId}
          assignedAgentId={assignedAgentId}
          onAgentChange={setAssignedAgentId}
          taskMilestones={taskMilestones}
          agents={agents}
        />

        {suggestion && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Suggested: {suggestion.agent.agent_name} ({suggestion.confidence}% match)
            </span>
            <button
              type="button"
              onClick={() => setAssignedAgentId(suggestion.agent.agent_id)}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                cursor: "pointer",
                color: "var(--text-primary)",
              }}
            >
              Apply
            </button>
          </div>
        )}

        <TaskDateFields
          dueDate={dueDate}
          onDueDateChange={setDueDate}
          estimate={estimate}
          onEstimateChange={setEstimate}
          startDate={startDate}
          onStartDateChange={setStartDate}
          recurrenceRule={recurrenceRule}
          onRecurrenceRuleChange={setRecurrenceRule}
        />

        {/* Tags */}
        <TagPicker
          taskId={task.id}
          currentTags={currentTags}
          availableTags={availableTags}
          projectTagCount={projectTags.length}
        />

        <FormField id="task-progress" label={`Progress — ${progress}%`}>
          <input
            id="task-progress"
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--accent-green)" }}
          />
        </FormField>

        {/* Comments */}
        <CommentsSection
          comments={comments}
          newComment={newComment}
          onNewCommentChange={setNewComment}
          onSubmitComment={submitComment}
        />

        <TaskDrawerActions
          saving={saving}
          showMarkDone={task.status !== "done"}
          onSave={handleSave}
          onMarkDone={handleMarkDone}
        />
      </ModalDrawer>
      </div>
    </FocusTrap>
  );
}

const inputStyle: React.CSSProperties = sharedInputStyle;
