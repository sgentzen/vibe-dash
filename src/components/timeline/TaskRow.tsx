import { PRIORITY_COLORS } from "../../constants/colors.js";
import type { Task, Milestone } from "../../types";
import { BAR_HEIGHT, ROW_HEIGHT, STATUS_DOT_COLORS, STATUS_OPACITY, DAY_MS } from "./constants";
import { getTaskDates } from "./utils";
import { ResizeHandle } from "./ResizeHandle";

interface TaskRowProps {
  task: Task;
  labelWidth: number;
  timelineWidth: number;
  milestoneMap: Map<string, Milestone>;
  dateToX: (timeMs: number) => number;
  onResize: (delta: number) => void;
  depIds: string[];
  taskYMap: Map<string, number>;
  visibleTasks: Task[];
}

export function TaskRow({
  task,
  labelWidth,
  timelineWidth,
  milestoneMap,
  dateToX,
  onResize,
  depIds,
  taskYMap,
  visibleTasks,
}: TaskRowProps) {
  const dates = getTaskDates(task, milestoneMap);
  const start = dates ? dates.start : new Date(task.created_at).getTime();
  const end = dates ? dates.end : start + 7 * DAY_MS;
  const startX = dateToX(start);
  const endX = dateToX(end);
  const barWidth = Math.max(endX - startX, 8);
  const color = PRIORITY_COLORS[task.priority] ?? "var(--accent-purple)";
  const opacity = STATUS_OPACITY[task.status] ?? 1;
  const hasDates = dates !== null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: ROW_HEIGHT,
        position: "relative",
        zIndex: 1,
      }}
    >
      {/* Label with status dot + resize handle */}
      <div
        style={{
          width: labelWidth,
          fontSize: "12px",
          color: "var(--text-primary)",
          padding: "0 12px 0 16px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          position: "relative",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            flexShrink: 0,
            background: STATUS_DOT_COLORS[task.status] ?? "var(--text-muted)",
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
        <ResizeHandle onResize={onResize} />
      </div>
      {/* Bar */}
      <div style={{ position: "relative", width: timelineWidth }}>
        <div
          title={`${task.title}\n${task.start_date ?? "no start"} → ${task.due_date ?? "no due"}\nStatus: ${task.status} | Priority: ${task.priority}`}
          style={{
            position: "absolute",
            left: startX,
            top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
            width: barWidth,
            height: BAR_HEIGHT,
            borderRadius: "4px",
            background: color,
            opacity: hasDates ? opacity : opacity * 0.3,
            display: "flex",
            alignItems: "center",
            paddingLeft: "6px",
            fontSize: "11px",
            color: "var(--text-on-accent)",
            fontWeight: 500,
            overflow: "hidden",
            whiteSpace: "nowrap",
            border: hasDates ? "none" : "1px dashed rgba(255,255,255,0.3)",
          }}
        >
          {barWidth > 60 ? task.title : ""}
        </div>

        {/* Dependency arrows */}
        {depIds.map((depId) => {
          const depEndY = taskYMap.get(depId);
          const thisY = taskYMap.get(task.id);
          if (depEndY === undefined || thisY === undefined) return null;

          const depTask = visibleTasks.find((t) => t.id === depId);
          if (!depTask) return null;
          const depDates = getTaskDates(depTask, milestoneMap);
          const depEnd = depDates
            ? depDates.end
            : new Date(depTask.created_at).getTime() + 7 * DAY_MS;
          const depEndX = dateToX(depEnd);
          const fromY = depEndY - thisY;

          return (
            <svg
              key={depId}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: timelineWidth,
                height: ROW_HEIGHT,
                overflow: "visible",
                pointerEvents: "none",
              }}
            >
              <line
                x1={depEndX}
                y1={fromY + ROW_HEIGHT / 2}
                x2={startX}
                y2={ROW_HEIGHT / 2}
                stroke="var(--accent-red)"
                strokeWidth={1}
                strokeDasharray="4,2"
                markerEnd="url(#arrowhead)"
              />
            </svg>
          );
        })}
      </div>
    </div>
  );
}
