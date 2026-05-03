import type { Task, Milestone, Blocker } from "../../types";
import { BAR_HEIGHT, ROW_HEIGHT, STATUS_DOT_COLORS, DAY_MS } from "./constants";
import { getTaskDates } from "./utils";
import { ResizeHandle } from "./ResizeHandle";

interface TaskRowProps {
  task: Task;
  labelWidth: number;
  timelineWidth: number;
  milestoneMap: Map<string, Milestone>;
  dateToX: (timeMs: number) => number;
  onResize: (delta: number) => void;
  blockers: Blocker[];
  onBarClick: (task: Task) => void;
}

type Anomaly = "blocked" | "overdue" | "stale" | null;

function detectAnomaly(task: Task, blockers: Blocker[]): Anomaly {
  if (blockers.some((b) => b.task_id === task.id && !b.resolved_at)) return "blocked";
  if (task.status === "done") return null;
  const now = Date.now();
  if (task.due_date && new Date(task.due_date).getTime() < now) return "overdue";
  if (task.updated_at) {
    const staleDays = (now - new Date(task.updated_at).getTime()) / DAY_MS;
    if (staleDays > 7 && task.status === "in_progress") return "stale";
  }
  return null;
}

function barStyle(task: Task, hasDates: boolean, anomaly: Anomaly) {
  const base: React.CSSProperties = {
    height: BAR_HEIGHT,
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    paddingLeft: "6px",
    fontSize: "11px",
    fontWeight: 500,
    overflow: "hidden",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
  };

  if (anomaly === "blocked") {
    return { ...base, background: "var(--status-danger)", color: "var(--text-on-accent)", opacity: hasDates ? 1 : 0.5 };
  }
  if (anomaly === "overdue") {
    return { ...base, background: "var(--status-warning)", color: "var(--text-on-yellow)", opacity: hasDates ? 1 : 0.5 };
  }

  switch (task.status) {
    case "done":
      return { ...base, background: "var(--status-info)", color: "var(--text-on-accent)", opacity: 0.35 };
    case "in_progress":
      return { ...base, background: "var(--status-success)", color: "var(--text-on-accent)", opacity: hasDates ? 1 : 0.6 };
    case "blocked":
      return { ...base, background: "var(--status-danger)", color: "var(--text-on-accent)", opacity: hasDates ? 1 : 0.5 };
    case "planned":
    default:
      return {
        ...base,
        background: "var(--bg-tertiary)",
        color: "var(--text-secondary)",
        border: hasDates ? "1px solid var(--border)" : "1px dashed var(--border)",
        opacity: hasDates ? 0.9 : 0.6,
      };
  }
}

const ANOMALY_ICON: Record<NonNullable<Anomaly>, string> = {
  blocked: "🚫",
  overdue: "⚠",
  stale: "⚠",
};

export function TaskRow({
  task,
  labelWidth,
  timelineWidth,
  milestoneMap,
  dateToX,
  onResize,
  blockers,
  onBarClick,
}: TaskRowProps) {
  const dates = getTaskDates(task, milestoneMap);
  const start = dates ? dates.start : new Date(task.created_at).getTime();
  const end = dates ? dates.end : start + 7 * DAY_MS;
  const startX = dateToX(start);
  const endX = dateToX(end);
  const barWidth = Math.max(endX - startX, 8);
  const hasDates = dates !== null;
  const anomaly = detectAnomaly(task, blockers);
  const style = barStyle(task, hasDates, anomaly);
  const barTop = (ROW_HEIGHT - BAR_HEIGHT) / 2;
  const showBalloon = anomaly !== null && barWidth >= 20;

  return (
    <div
      className="timeline-task-row"
      style={{
        display: "flex",
        alignItems: "center",
        height: ROW_HEIGHT,
        position: "relative",
        zIndex: 1,
      }}
    >
      {/* Label */}
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
          className="legend-dot"
          style={{ background: STATUS_DOT_COLORS[task.status] ?? "var(--text-muted)" }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
        <ResizeHandle onResize={onResize} />
      </div>

      {/* Timeline track */}
      <div style={{ position: "relative", width: timelineWidth }}>
        {/* Balloon anomaly indicator */}
        {showBalloon && (
          <span
            aria-hidden="true"
            className={`timeline-balloon timeline-balloon--${anomaly}`}
            style={{
              position: "absolute",
              left: startX + barWidth / 2 - 7,
              top: barTop - 16,
              fontSize: "12px",
              lineHeight: 1,
            }}
          >
            {ANOMALY_ICON[anomaly]}
          </span>
        )}

        <button
          className="timeline-bar"
          aria-label={`${task.title} — ${task.status}${anomaly ? `, ${anomaly}` : ""}, ${task.start_date ?? "no start"} to ${task.due_date ?? "no due date"}`}
          onClick={() => onBarClick(task)}
          style={{
            ...style,
            position: "absolute",
            left: startX,
            top: barTop,
            width: barWidth,
          }}
        >
          {barWidth > 60 ? task.title : ""}
        </button>
      </div>
    </div>
  );
}
