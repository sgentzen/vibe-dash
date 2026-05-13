import type { Agent, Milestone, TaskPriority, TaskStatus } from "../../types";
import { FormField } from "../ui/FormField";
import { FormSelect } from "../ui/FormSelect";

interface TaskMetadataFieldsProps {
  status: TaskStatus;
  onStatusChange: (s: TaskStatus) => void;
  priority: TaskPriority;
  onPriorityChange: (p: TaskPriority) => void;
  milestoneId: string | null;
  onMilestoneChange: (id: string | null) => void;
  assignedAgentId: string | null;
  onAgentChange: (id: string | null) => void;
  taskMilestones: Milestone[];
  agents: Agent[];
}

export function TaskMetadataFields({
  status,
  onStatusChange,
  priority,
  onPriorityChange,
  milestoneId,
  onMilestoneChange,
  assignedAgentId,
  onAgentChange,
  taskMilestones,
  agents,
}: TaskMetadataFieldsProps) {
  return (
    <>
      <FormField id="task-status" label="Status">
        <FormSelect
          id="task-status"
          value={status}
          onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
        >
          <option value="planned">Planned</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </FormSelect>
      </FormField>

      <FormField id="task-priority" label="Priority">
        <FormSelect
          id="task-priority"
          value={priority}
          onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </FormSelect>
      </FormField>

      {taskMilestones.length > 0 && (
        <FormField id="task-milestone" label="Milestone">
          <FormSelect
            id="task-milestone"
            value={milestoneId ?? ""}
            onChange={(e) => onMilestoneChange(e.target.value || null)}
          >
            <option value="">No Milestone</option>
            {taskMilestones.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </FormSelect>
        </FormField>
      )}

      {agents.length > 0 && (
        <FormField id="task-agent" label="Assigned Agent">
          <FormSelect
            id="task-agent"
            value={assignedAgentId ?? ""}
            onChange={(e) => onAgentChange(e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </FormSelect>
        </FormField>
      )}
    </>
  );
}
