import { useMemo } from "react";
import { useAppState } from "../store";
import type { Task, Sprint } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_HEIGHT = 24;
const ROW_HEIGHT = 32;
const LEFT_LABEL_WIDTH = 200;
const HEADER_HEIGHT = 40;

export function TimelineView() {
  const { tasks, sprints, selectedProjectId, selectedSprintId, taskDepsMap } = useAppState();

  const filteredTasks = tasks.filter(
    (t) =>
      t.parent_task_id === null &&
      (selectedProjectId === null || t.project_id === selectedProjectId) &&
      (selectedSprintId === null || t.sprint_id === selectedSprintId) &&
      (t.start_date || t.due_date) // must have at least one date
  );

  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (filteredTasks.length === 0) return { minDate: new Date(), maxDate: new Date(), totalDays: 30 };
    let min = Infinity;
    let max = -Infinity;
    for (const t of filteredTasks) {
      const start = t.start_date ? new Date(t.start_date).getTime() : t.created_at ? new Date(t.created_at).getTime() : Date.now();
      const end = t.due_date ? new Date(t.due_date).getTime() : start + 7 * DAY_MS;
      if (start < min) min = start;
      if (end > max) max = end;
    }
    // Add padding
    min -= 2 * DAY_MS;
    max += 2 * DAY_MS;
    return { minDate: new Date(min), maxDate: new Date(max), totalDays: Math.ceil((max - min) / DAY_MS) };
  }, [filteredTasks]);

  const timelineWidth = Math.max(totalDays * 30, 600);

  function dateToX(date: string | null, fallback: string): number {
    const d = date ? new Date(date).getTime() : new Date(fallback).getTime();
    return ((d - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * timelineWidth;
  }

  const priorityColor: Record<string, string> = {
    urgent: "var(--accent-red)", high: "var(--accent-yellow)",
    medium: "#6366f1", low: "var(--text-muted)",
  };

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
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "16px", fontWeight: 600 }}>
        Timeline
      </h2>

      {filteredTasks.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>
          No tasks with dates to display. Set start_date or due_date on tasks to see them here.
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
              const startX = s.start_date ? dateToX(s.start_date, s.created_at) : 0;
              const endX = s.end_date ? dateToX(s.end_date, s.created_at) : timelineWidth;
              return (
                <div key={s.id} style={{
                  position: "absolute", left: LEFT_LABEL_WIDTH + startX, top: HEADER_HEIGHT,
                  width: endX - startX, height: filteredTasks.length * ROW_HEIGHT,
                  background: "rgba(99,102,241,0.03)", borderLeft: "1px dashed rgba(99,102,241,0.3)",
                  borderRight: "1px dashed rgba(99,102,241,0.3)", zIndex: 0,
                }}>
                  <span style={{ position: "absolute", top: -14, fontSize: "9px", color: "#6366f1" }}>{s.name}</span>
                </div>
              );
            })}

            {/* Task rows */}
            {filteredTasks.map((task, i) => {
              const startX = dateToX(task.start_date, task.created_at);
              const endX = dateToX(task.due_date, task.start_date ?? task.created_at);
              const barWidth = Math.max(endX - startX, 8);
              const color = priorityColor[task.priority] ?? "#6366f1";
              const opacity = statusOpacity[task.status] ?? 1;

              return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", height: ROW_HEIGHT, position: "relative", zIndex: 1 }}>
                  {/* Label */}
                  <div style={{
                    width: LEFT_LABEL_WIDTH, fontSize: "11px", color: "var(--text-primary)",
                    padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    {task.title}
                  </div>
                  {/* Bar */}
                  <div style={{ position: "relative", width: timelineWidth }}>
                    <div
                      title={`${task.title}\n${task.start_date ?? "no start"} → ${task.due_date ?? "no due"}\nStatus: ${task.status} | Priority: ${task.priority}`}
                      style={{
                        position: "absolute", left: startX, top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                        width: barWidth, height: BAR_HEIGHT, borderRadius: "4px",
                        background: color, opacity,
                        display: "flex", alignItems: "center", paddingLeft: "6px",
                        fontSize: "10px", color: "#fff", fontWeight: 500,
                        overflow: "hidden", whiteSpace: "nowrap",
                      }}
                    >
                      {barWidth > 60 ? task.title : ""}
                    </div>

                    {/* Dependency arrows */}
                    {(taskDepsMap[task.id] ?? []).map((depId) => {
                      const depTask = filteredTasks.find((t) => t.id === depId);
                      if (!depTask) return null;
                      const depEndX = dateToX(depTask.due_date, depTask.start_date ?? depTask.created_at);
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
