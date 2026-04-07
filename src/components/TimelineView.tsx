import { useMemo, useState } from "react";
import { useAppState } from "../store";
import { PRIORITY_COLORS } from "../constants/colors.js";
import type { Task, Sprint, TaskStatus } from "../types";

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  done: "var(--accent-green)",
  in_progress: "var(--accent-blue)",
  blocked: "var(--accent-yellow)",
  planned: "var(--text-muted)",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_HEIGHT = 24;
const ROW_HEIGHT = 32;
const LEFT_LABEL_WIDTH = 200;
const HEADER_HEIGHT = 40;

function getTaskDates(task: Task, sprintMap: Map<string, Sprint>): { start: number; end: number } | null {
  const taskStart = task.start_date ? new Date(task.start_date).getTime() : null;
  const taskEnd = task.due_date ? new Date(task.due_date).getTime() : null;

  if (taskStart || taskEnd) {
    const start = taskStart ?? (taskEnd! - 7 * DAY_MS);
    const end = taskEnd ?? (taskStart! + 7 * DAY_MS);
    return { start, end };
  }

  // Fall back to sprint dates if the task belongs to a sprint with dates
  if (task.sprint_id) {
    const sprint = sprintMap.get(task.sprint_id);
    if (sprint) {
      const sprintStart = sprint.start_date ? new Date(sprint.start_date).getTime() : null;
      const sprintEnd = sprint.end_date ? new Date(sprint.end_date).getTime() : null;
      if (sprintStart || sprintEnd) {
        const start = sprintStart ?? (sprintEnd! - 14 * DAY_MS);
        const end = sprintEnd ?? (sprintStart! + 14 * DAY_MS);
        return { start, end };
      }
    }
  }

  return null;
}

export function TimelineView() {
  const { tasks, sprints, selectedProjectId, selectedSprintId, taskDepsMap } = useAppState();
  const [showUndated, setShowUndated] = useState(false);

  const sprintMap = useMemo(() => {
    const m = new Map<string, Sprint>();
    for (const s of sprints) m.set(s.id, s);
    return m;
  }, [sprints]);

  const allMatchingTasks = tasks.filter(
    (t) =>
      t.parent_task_id === null &&
      (selectedProjectId === null || t.project_id === selectedProjectId) &&
      (selectedSprintId === null || t.sprint_id === selectedSprintId)
  );

  const datedTasks = allMatchingTasks.filter((t) => getTaskDates(t, sprintMap) !== null);
  const undatedCount = allMatchingTasks.length - datedTasks.length;
  const unsortedTasks = showUndated ? allMatchingTasks : datedTasks;

  // Sort: dated tasks by start date ascending, then undated by created_at
  const filteredTasks = [...unsortedTasks].sort((a, b) => {
    const aDates = getTaskDates(a, sprintMap);
    const bDates = getTaskDates(b, sprintMap);
    if (aDates && !bDates) return -1;
    if (!aDates && bDates) return 1;
    const aStart = aDates ? aDates.start : new Date(a.created_at).getTime();
    const bStart = bDates ? bDates.start : new Date(b.created_at).getTime();
    return aStart - bStart;
  });

  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (filteredTasks.length === 0) return { minDate: new Date(), maxDate: new Date(), totalDays: 30 };
    let min = Infinity;
    let max = -Infinity;
    for (const t of filteredTasks) {
      const dates = getTaskDates(t, sprintMap);
      const start = dates ? dates.start : new Date(t.created_at).getTime();
      const end = dates ? dates.end : start + 7 * DAY_MS;
      if (start < min) min = start;
      if (end > max) max = end;
    }
    // Add padding
    min -= 2 * DAY_MS;
    max += 2 * DAY_MS;
    return { minDate: new Date(min), maxDate: new Date(max), totalDays: Math.ceil((max - min) / DAY_MS) };
  }, [filteredTasks, sprintMap]);

  const timelineWidth = Math.max(totalDays * 30, 600);

  function dateToX(timeMs: number): number {
    return ((timeMs - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * timelineWidth;
  }

  const statusOpacity: Record<string, number> = {
    done: 0.4, blocked: 0.6, in_progress: 1, planned: 0.8,
  };

  // Sprint boundaries
  const activeSprints = sprints.filter((s) =>
    (selectedProjectId === null || s.project_id === selectedProjectId) &&
    (s.start_date || s.end_date)
  );

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <h2 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600, margin: 0 }}>
          Timeline
        </h2>
        {undatedCount > 0 && (
          <button
            onClick={() => setShowUndated(!showUndated)}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "11px",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {showUndated ? "Hide" : "Show"} {undatedCount} undated task{undatedCount !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {filteredTasks.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>
          {undatedCount > 0 && datedTasks.length === 0 ? (
            <div>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                No tasks have dates set
              </div>
              <div style={{ fontSize: "12px" }}>
                Add start_date and due_date to tasks to build a useful timeline.
                {!showUndated && ` ${undatedCount} undated task${undatedCount !== 1 ? "s" : ""} hidden.`}
              </div>
            </div>
          ) : (
            <>No tasks to display.{undatedCount > 0 ? ` ${undatedCount} tasks have no dates set.` : ""}</>
          )}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ position: "relative", minWidth: LEFT_LABEL_WIDTH + timelineWidth + 20 }}>
            {/* Date header */}
            <div style={{ display: "flex", marginLeft: LEFT_LABEL_WIDTH, height: HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}>
              {Array.from({ length: Math.min(totalDays, 60) }, (_, i) => {
                const d = new Date(minDate.getTime() + i * DAY_MS);
                const isWeekStart = d.getUTCDay() === 1;
                return (
                  <div
                    key={i}
                    style={{
                      width: `${timelineWidth / totalDays}px`,
                      textAlign: "center",
                      fontSize: "9px",
                      color: isWeekStart ? "var(--text-primary)" : "var(--text-muted)",
                      fontWeight: isWeekStart ? 600 : 400,
                      borderLeft: isWeekStart ? "1px solid var(--border)" : "none",
                      paddingTop: "4px",
                    }}
                  >
                    {isWeekStart ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : ""}
                  </div>
                );
              })}
            </div>

            {/* Sprint boundaries */}
            {activeSprints.map((s) => {
              if (!s.start_date && !s.end_date) return null;
              const startX = dateToX(new Date(s.start_date ?? s.created_at).getTime());
              const endX = s.end_date ? dateToX(new Date(s.end_date).getTime()) : timelineWidth;
              return (
                <div key={s.id} style={{
                  position: "absolute", left: LEFT_LABEL_WIDTH + startX, top: HEADER_HEIGHT,
                  width: Math.max(endX - startX, 1), height: filteredTasks.length * ROW_HEIGHT,
                  background: "rgba(99,102,241,0.03)", borderLeft: "1px dashed rgba(99,102,241,0.3)",
                  borderRight: "1px dashed rgba(99,102,241,0.3)", zIndex: 0,
                }}>
                  <span style={{ position: "absolute", top: -14, fontSize: "9px", color: "var(--accent-purple)", whiteSpace: "nowrap" }}>{s.name}</span>
                </div>
              );
            })}

            {/* Today marker */}
            {(() => {
              const todayX = dateToX(Date.now());
              if (todayX > 0 && todayX < timelineWidth) {
                return (
                  <div style={{
                    position: "absolute",
                    left: LEFT_LABEL_WIDTH + todayX,
                    top: 0,
                    width: "2px",
                    height: HEADER_HEIGHT + filteredTasks.length * ROW_HEIGHT,
                    background: "var(--accent-red)",
                    zIndex: 2,
                    pointerEvents: "none",
                  }}>
                    <span style={{
                      position: "absolute",
                      top: "2px",
                      left: "4px",
                      fontSize: "9px",
                      color: "var(--accent-red)",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}>
                      Today
                    </span>
                  </div>
                );
              }
              return null;
            })()}

            {/* Task rows */}
            {filteredTasks.map((task, i) => {
              const dates = getTaskDates(task, sprintMap);
              const start = dates ? dates.start : new Date(task.created_at).getTime();
              const end = dates ? dates.end : start + 7 * DAY_MS;
              const startX = dateToX(start);
              const endX = dateToX(end);
              const barWidth = Math.max(endX - startX, 8);
              const color = PRIORITY_COLORS[task.priority] ?? "var(--accent-purple)";
              const opacity = statusOpacity[task.status] ?? 1;
              const hasDates = dates !== null;

              return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", height: ROW_HEIGHT, position: "relative", zIndex: 1 }}>
                  {/* Label with status dot */}
                  <div style={{
                    width: LEFT_LABEL_WIDTH, fontSize: "11px", color: "var(--text-primary)",
                    padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flexShrink: 0, display: "flex", alignItems: "center", gap: "6px",
                  }}>
                    <span style={{
                      width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0,
                      background: STATUS_DOT_COLORS[task.status] ?? "var(--text-muted)",
                    }} />
                    {task.title}
                  </div>
                  {/* Bar */}
                  <div style={{ position: "relative", width: timelineWidth }}>
                    <div
                      title={`${task.title}\n${task.start_date ?? "no start"} → ${task.due_date ?? "no due"}\nStatus: ${task.status} | Priority: ${task.priority}`}
                      style={{
                        position: "absolute", left: startX, top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                        width: barWidth, height: BAR_HEIGHT, borderRadius: "4px",
                        background: color, opacity: hasDates ? opacity : opacity * 0.3,
                        display: "flex", alignItems: "center", paddingLeft: "6px",
                        fontSize: "10px", color: "var(--text-on-accent)", fontWeight: 500,
                        overflow: "hidden", whiteSpace: "nowrap",
                        border: hasDates ? "none" : "1px dashed rgba(255,255,255,0.3)",
                      }}
                    >
                      {barWidth > 60 ? task.title : ""}
                    </div>

                    {/* Dependency arrows */}
                    {(taskDepsMap[task.id] ?? []).map((depId) => {
                      const depTask = filteredTasks.find((t) => t.id === depId);
                      if (!depTask) return null;
                      const depDates = getTaskDates(depTask, sprintMap);
                      const depEnd = depDates ? depDates.end : new Date(depTask.created_at).getTime() + 7 * DAY_MS;
                      const depEndX = dateToX(depEnd);
                      const depRow = filteredTasks.indexOf(depTask);
                      if (depRow === -1) return null;
                      const fromY = (depRow - i) * ROW_HEIGHT;

                      return (
                        <svg key={depId} style={{ position: "absolute", left: 0, top: 0, width: timelineWidth, height: ROW_HEIGHT, overflow: "visible", pointerEvents: "none" }}>
                          <line
                            x1={depEndX} y1={fromY + ROW_HEIGHT / 2}
                            x2={startX} y2={ROW_HEIGHT / 2}
                            stroke="var(--accent-red)" strokeWidth={1} strokeDasharray="4,2"
                            markerEnd="url(#arrowhead)"
                          />
                        </svg>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Arrow marker definition */}
            <svg style={{ position: "absolute", width: 0, height: 0 }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent-red)" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
