import { useState, useEffect } from "react";
import { FocusTrap } from "focus-trap-react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { inputStyle as sharedInputStyle } from "../styles/shared.js";
import type { Task, TaskStatus, TaskPriority } from "../types";
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

export function TaskEditDrawer({ task, onClose }: Readonly<TaskEditDrawerProps>) {
  const { milestones, agents } = useAppState();
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
  const [estimate, setEstimate] = useState<string>(task.estimate == null ? "" : String(task.estimate));
  const [startDate, setStartDate] = useState<string>(task.start_date ?? "");
  const [saving, setSaving] = useState(false);

  const taskMilestones = milestones.filter((m) => m.project_id === task.project_id);

  // Close on Escape (handled here so focus-trap's onDeactivate doesn't fire
  // during React StrictMode's dev mount-unmount-remount cycle and instantly close us)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
    setEstimate(task.estimate == null ? "" : String(task.estimate));
    setStartDate(task.start_date ?? "");
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
        estimate: estimate ? Number.parseInt(estimate, 10) : null,
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
    <FocusTrap focusTrapOptions={{ clickOutsideDeactivates: false, allowOutsideClick: true, escapeDeactivates: false }}>
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

        <TaskDateFields
          dueDate={dueDate}
          onDueDateChange={setDueDate}
          estimate={estimate}
          onEstimateChange={setEstimate}
          startDate={startDate}
          onStartDateChange={setStartDate}
        />

        <FormField id="task-progress" label={`Progress — ${progress}%`}>
          <input
            id="task-progress"
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            style={{ width: "100%", accentColor: "var(--status-success)" }}
          />
        </FormField>

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
