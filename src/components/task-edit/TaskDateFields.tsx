import { inputStyle as sharedInputStyle } from "../../styles/shared.js";
import { FormField } from "../ui/FormField";
import { FormSelect } from "../ui/FormSelect";
import { FormDateInput } from "../ui/FormDateInput";

interface TaskDateFieldsProps {
  dueDate: string;
  onDueDateChange: (v: string) => void;
  estimate: string;
  onEstimateChange: (v: string) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  recurrenceRule: string;
  onRecurrenceRuleChange: (v: string) => void;
}

export function TaskDateFields({
  dueDate,
  onDueDateChange,
  estimate,
  onEstimateChange,
  startDate,
  onStartDateChange,
  recurrenceRule,
  onRecurrenceRuleChange,
}: TaskDateFieldsProps) {
  return (
    <>
      <FormField id="task-due-date" label="Due Date">
        <FormDateInput
          id="task-due-date"
          value={dueDate}
          onChange={(e) => onDueDateChange(e.target.value)}
        />
      </FormField>

      <FormField id="task-estimate" label="Estimate (story points)">
        <input
          id="task-estimate"
          type="number"
          min={0}
          value={estimate}
          onChange={(e) => onEstimateChange(e.target.value)}
          placeholder="0"
          style={sharedInputStyle}
        />
      </FormField>

      <FormField id="task-start-date" label="Start Date">
        <FormDateInput
          id="task-start-date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
        />
      </FormField>

      <FormField id="task-recurrence" label="Recurrence Rule">
        <FormSelect
          id="task-recurrence"
          value={recurrenceRule}
          onChange={(e) => onRecurrenceRuleChange(e.target.value)}
        >
          <option value="">None</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </FormSelect>
      </FormField>
    </>
  );
}
