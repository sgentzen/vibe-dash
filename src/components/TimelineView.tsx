import { useCallback, useMemo, useState } from "react";
import { useAppState } from "../store";
import type { Milestone, Task } from "../types";
import {
  DAY_MS,
  DEFAULT_LABEL_WIDTH,
  HEADER_HEIGHT,
  MAX_LABEL_WIDTH,
  MILESTONE_ROW_HEIGHT,
  MIN_LABEL_WIDTH,
  MONTH_HEADER_HEIGHT,
  PROJECT_HEADER_HEIGHT,
  ROW_HEIGHT,
  STATUS_DOT_COLORS,
} from "./timeline/constants";
import { buildSwimRows, getTaskDates, type SwimRow } from "./timeline/utils";
import { DateHeader } from "./timeline/DateHeader";
import { TaskEditDrawer } from "./TaskEditDrawer";

const MAX_DAYS = 60;

const LEGEND: { status: keyof typeof STATUS_DOT_COLORS; label: string }[] = [
  { status: "in_progress", label: "Running" },
  { status: "blocked", label: "Failed" },
  { status: "planned", label: "Planned" },
  { status: "done", label: "Completed" },
];

type Anomaly = "blocked" | "overdue" | "stale" | null;

function detectAnomaly(task: Task, blockers: import("../types").Blocker[]): Anomaly {
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

function barStyle(task: Task, hasDates: boolean, anomaly: Anomaly): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 22,
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
    return { ...base, background: "var(--accent-red)", color: "var(--text-on-accent)", opacity: hasDates ? 1 : 0.5 };
  }
  if (anomaly === "overdue" || anomaly === "stale") {
    return { ...base, background: "var(--accent-yellow)", color: "var(--text-on-yellow)", opacity: hasDates ? (anomaly === "stale" ? 0.8 : 1) : 0.5 };
  }

  switch (task.status) {
    case "done":
      return { ...base, background: "var(--accent-blue)", color: "var(--text-on-accent)", opacity: 0.35 };
    case "in_progress":
      return { ...base, background: "var(--accent-green)", color: "var(--text-on-accent)", opacity: hasDates ? 1 : 0.6 };
    case "blocked":
      return { ...base, background: "var(--accent-red)", color: "var(--text-on-accent)", opacity: hasDates ? 1 : 0.5 };
    default:
      return { ...base, background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: hasDates ? "1px solid var(--border)" : "1px dashed var(--border)", opacity: hasDates ? 0.9 : 0.6 };
  }
}

function rowHeight(row: SwimRow): number {
  if (row.kind === "project") return PROJECT_HEADER_HEIGHT;
  if (row.kind === "milestone") return MILESTONE_ROW_HEIGHT;
  return ROW_HEIGHT;
}

export function TimelineView() {
  const { tasks, milestones, projects, agents, selectedProjectId, selectedMilestoneId, blockers, taskDepsMap } =
    useAppState();
  const [showUndated, setShowUndated] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const milestoneMap = useMemo(() => {
    const m = new Map<string, Milestone>();
    for (const s of milestones) m.set(s.id, s);
    return m;
  }, [milestones]);

  const filteredTasks = useMemo(() => {
    let result = tasks.filter(
      (t) =>
        t.parent_task_id === null &&
        (selectedProjectId === null || t.project_id === selectedProjectId) &&
        (selectedMilestoneId === null || t.milestone_id === selectedMilestoneId),
    );
    if (hideCompleted) result = result.filter((t) => t.status !== "done");
    if (!showUndated) result = result.filter((t) => getTaskDates(t, milestoneMap) !== null);
    return result;
  }, [tasks, selectedProjectId, selectedMilestoneId, hideCompleted, showUndated, milestoneMap]);

  const allMatchingTasks = tasks.filter(
    (t) =>
      t.parent_task_id === null &&
      (selectedProjectId === null || t.project_id === selectedProjectId) &&
      (selectedMilestoneId === null || t.milestone_id === selectedMilestoneId),
  );
  const undatedCount = allMatchingTasks.filter((t) => getTaskDates(t, milestoneMap) === null).length;
  const completedCount = allMatchingTasks.filter((t) => t.status === "done").length;
  const allDone = allMatchingTasks.length > 0 && completedCount === allMatchingTasks.length;

  const filteredMilestones = milestones.filter(
    (m) => selectedProjectId === null || m.project_id === selectedProjectId,
  );
  const filteredProjects = projects.filter(
    (p) => selectedProjectId === null || p.id === selectedProjectId,
  );

  const swimRows = useMemo(
    () => buildSwimRows(filteredTasks, filteredMilestones, filteredProjects, agents),
    [filteredTasks, filteredMilestones, filteredProjects, agents],
  );

  // Flatten for render, respecting collapsed projects
  const flatRows = useMemo(() => {
    const result: SwimRow[] = [];
    let currentProjectCollapsed = false;
    for (const row of swimRows) {
      if (row.kind === "project") {
        currentProjectCollapsed = collapsedProjects.has(row.project.id);
        result.push(row);
      } else if (!currentProjectCollapsed) {
        result.push(row);
      }
    }
    return result;
  }, [swimRows, collapsedProjects]);

  const visibleTasks = useMemo(
    () => flatRows.filter((r): r is Extract<SwimRow, { kind: "agent" }> => r.kind === "agent").flatMap((r) => r.tasks),
    [flatRows],
  );

  const { minDate, maxDate, totalDays, clipped } = useMemo(() => {
    if (visibleTasks.length === 0) {
      const now = Date.now();
      return { minDate: new Date(now - 2 * DAY_MS), maxDate: new Date(now + 28 * DAY_MS), totalDays: 30, clipped: false };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const t of visibleTasks) {
      const dates = getTaskDates(t, milestoneMap);
      const start = dates ? dates.start : new Date(t.created_at).getTime();
      const end = dates ? dates.end : start + 7 * DAY_MS;
      if (start < min) min = start;
      if (end > max) max = end;
    }
    min -= 2 * DAY_MS;
    max += 2 * DAY_MS;
    const days = Math.ceil((max - min) / DAY_MS);
    const clipped = days > MAX_DAYS;
    const clampedMax = clipped ? min + MAX_DAYS * DAY_MS : max;
    return { minDate: new Date(min), maxDate: new Date(clampedMax), totalDays: clipped ? MAX_DAYS : days, clipped };
  }, [visibleTasks, milestoneMap]);

  const timelineWidth = Math.max(totalDays * 30, 600);

  const dateToX = useCallback(
    (timeMs: number): number =>
      ((timeMs - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * timelineWidth,
    [minDate, maxDate, timelineWidth],
  );

  const handleResize = useCallback((delta: number) => {
    setLabelWidth((w) => Math.max(MIN_LABEL_WIDTH, Math.min(MAX_LABEL_WIDTH, w + delta)));
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const totalContentHeight = useMemo(
    () => flatRows.reduce((h, r) => h + rowHeight(r), 0),
    [flatRows],
  );

  const mondayLines = useMemo(() => {
    const lines: number[] = [];
    const start = new Date(minDate);
    const day = start.getDay();
    const daysSinceMonday = (day + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    while (start.getTime() < maxDate.getTime()) {
      const x = dateToX(start.getTime());
      if (x >= 0) lines.push(x);
      start.setDate(start.getDate() + 7);
    }
    return lines;
  }, [minDate, maxDate, dateToX]);

  const todayX = dateToX(Date.now());
  const todayVisible = todayX > 0 && todayX < timelineWidth;

  // Build taskY map for dep SVG
  const taskYMap = useMemo(() => {
    const map = new Map<string, number>();
    let y = 0;
    for (const r of flatRows) {
      if (r.kind === "agent") {
        for (const t of r.tasks) map.set(t.id, y + ROW_HEIGHT / 2);
      }
      y += rowHeight(r);
    }
    return map;
  }, [flatRows]);

  if (filteredTasks.length === 0 && !allDone) {
    const emptyMsg = undatedCount > 0 && filteredTasks.length === 0
      ? "No tasks have dates set — add start_date and due_date to build a timeline."
      : "No tasks to display.";
    return (
      <div style={{ flex: 1, padding: "16px" }}>
        <Toolbar
          hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
          showUndated={showUndated} setShowUndated={setShowUndated}
          undatedCount={undatedCount} clipped={false}
        />
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "60px 40px" }}>
          {allDone && hideCompleted ? (
            <>
              <div style={{ fontSize: "18px", marginBottom: "8px" }}>All tasks complete</div>
              <button onClick={() => setHideCompleted(false)} style={{ background: "none", border: "none", color: "var(--accent-blue)", cursor: "pointer", fontSize: "12px" }}>
                Show {completedCount} completed task{completedCount !== 1 ? "s" : ""}
              </button>
            </>
          ) : emptyMsg}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      <Toolbar
        hideCompleted={hideCompleted} setHideCompleted={setHideCompleted}
        showUndated={showUndated} setShowUndated={setShowUndated}
        undatedCount={undatedCount} clipped={clipped}
      />

      <div style={{ overflowX: "auto" }}>
        <div style={{ position: "relative", minWidth: labelWidth + timelineWidth + 20 }}>
          <DateHeader minDate={minDate} totalDays={totalDays} timelineWidth={timelineWidth} labelWidth={labelWidth} />

          {/* Week rules */}
          {mondayLines.map((x, i) => (
            <div key={i} style={{ position: "absolute", left: labelWidth + x, top: MONTH_HEADER_HEIGHT, width: 1, height: HEADER_HEIGHT - MONTH_HEADER_HEIGHT + totalContentHeight, background: "var(--border)", opacity: 0.3, pointerEvents: "none", zIndex: 0 }} />
          ))}

          {/* Today marker */}
          {todayVisible && (
            <div style={{ position: "absolute", left: labelWidth + todayX, top: 0, width: 2, height: HEADER_HEIGHT + totalContentHeight, background: "var(--accent-red)", zIndex: 2, pointerEvents: "none" }}>
              <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid var(--accent-red)" }} />
              <span style={{ position: "absolute", top: "8px", left: "4px", fontSize: "11px", color: "var(--accent-red)", fontWeight: 600, whiteSpace: "nowrap" }}>Today</span>
            </div>
          )}

          {/* Rows */}
          {flatRows.map((row, i) => {
            if (row.kind === "project") {
              const collapsed = collapsedProjects.has(row.project.id);
              return (
                <button
                  key={`proj-${row.project.id}`}
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={`${row.project.name} project, ${row.completedCount} of ${row.totalCount} tasks complete. ${collapsed ? "Expand" : "Collapse"}.`}
                  onClick={() => toggleProject(row.project.id)}
                  style={{ display: "flex", alignItems: "center", width: "100%", height: PROJECT_HEADER_HEIGHT, cursor: "pointer", background: "color-mix(in srgb, var(--accent-blue) 8%, var(--bg-secondary))", borderTop: "1px solid color-mix(in srgb, var(--accent-blue) 20%, var(--border))", borderBottom: "1px solid color-mix(in srgb, var(--accent-blue) 20%, var(--border))", border: "none", position: "relative", zIndex: 1, textAlign: "left" }}
                >
                  <div style={{ width: labelWidth, flexShrink: 0, display: "flex", alignItems: "center", gap: "8px", padding: "0 12px" }}>
                    <span aria-hidden="true" style={{ fontSize: "9px", color: "var(--accent-blue)", transition: "transform 0.15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", flexShrink: 0 }}>▼</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.06em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.project.name}
                    </span>
                    <span aria-hidden="true" style={{ fontSize: "10px", color: "var(--text-muted)", flexShrink: 0 }}>
                      {row.completedCount}/{row.totalCount}
                    </span>
                  </div>
                  <div aria-hidden="true" style={{ flex: 1, height: "100%", borderLeft: "1px solid var(--border)" }} />
                </button>
              );
            }

            if (row.kind === "milestone") {
              const m = row.milestone;
              if (!m.target_date) return null;
              const endMs = new Date(m.target_date).getTime();
              const startMs = (m as any).start_date ? new Date((m as any).start_date).getTime() : endMs - 14 * DAY_MS;
              const x1 = Math.max(0, dateToX(startMs));
              const x2 = Math.min(timelineWidth, dateToX(endMs));
              const bw = Math.max(x2 - x1, 20);
              return (
                <div key={`ms-${m.id}`} style={{ display: "flex", alignItems: "center", height: MILESTONE_ROW_HEIGHT, borderBottom: "1px solid var(--border)", position: "relative", background: "var(--bg-primary)" }}>
                  <div style={{ width: labelWidth, flexShrink: 0, padding: "0 12px 0 28px", fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.name}
                  </div>
                  <div style={{ position: "relative", width: timelineWidth }}>
                    <div style={{ position: "absolute", left: x1, top: (MILESTONE_ROW_HEIGHT - 12) / 2, width: bw, height: 12, borderRadius: "6px", background: "var(--accent-purple)", opacity: 0.7, display: "flex", alignItems: "center", paddingLeft: "6px", overflow: "hidden" }}>
                      <span style={{ fontSize: "10px", color: "var(--text-on-accent)", whiteSpace: "nowrap", fontWeight: 600 }}>{bw > 80 ? m.name : ""}</span>
                    </div>
                  </div>
                </div>
              );
            }

            // Agent lane row
            const { agentName, tasks: agentTasks } = row;
            return (
              <div key={`agent-${row.projectId}-${row.agentId ?? "unassigned"}-${i}`} className="timeline-task-row" style={{ display: "flex", alignItems: "center", height: ROW_HEIGHT, borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)", position: "relative" }}>
                {/* Label */}
                <div style={{ width: labelWidth, flexShrink: 0, display: "flex", alignItems: "center", gap: "8px", padding: "0 12px 0 24px", overflow: "hidden", position: "relative" }}>
                  <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agentName}
                  </span>
                  {/* Resize handle */}
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const startX = e.clientX;
                      const startW = labelWidth;
                      const onMove = (ev: MouseEvent) => handleResize(ev.clientX - startX + startW - labelWidth);
                      const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                    style={{ position: "absolute", right: 0, top: 0, width: "4px", height: "100%", cursor: "col-resize", background: "transparent" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--border)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                  />
                </div>

                {/* Bars */}
                <div style={{ position: "relative", width: timelineWidth, height: ROW_HEIGHT }}>
                  {agentTasks.map((task) => {
                    const dates = getTaskDates(task, milestoneMap);
                    const startMs = dates ? dates.start : new Date(task.created_at).getTime();
                    const endMs = dates ? dates.end : startMs + 7 * DAY_MS;
                    const sx = dateToX(startMs);
                    const ex = dateToX(endMs);
                    const bw = Math.max(ex - sx, 8);
                    const hasDates = dates !== null;
                    const anomaly = detectAnomaly(task, blockers);
                    const style = barStyle(task, hasDates, anomaly);
                    const barTop = (ROW_HEIGHT - 22) / 2;
                    const showHump = anomaly !== null && bw >= 20;
                    const humpColor = anomaly === "blocked" ? "var(--accent-red)" : "var(--accent-yellow)";
                    const hw = Math.min(bw, 60);

                    return (
                      <div key={task.id}>
                        {/* Gaussian hump anomaly indicator */}
                        {showHump && (
                          <svg
                            role="img"
                            aria-label={`Anomaly: ${anomaly}`}
                            style={{ position: "absolute", left: sx + bw / 2 - hw / 2, top: barTop - 18, width: hw, height: 18, overflow: "visible", pointerEvents: "none" }}
                            className={`timeline-balloon timeline-balloon--${anomaly}`}
                          >
                            <path
                              d={`M 0 18 C ${hw * 0.25} -2 ${hw * 0.75} -2 ${hw} 18`}
                              fill={humpColor}
                              fillOpacity="0.75"
                              stroke="none"
                            />
                          </svg>
                        )}
                        <button
                          className="timeline-bar"
                          aria-label={`${task.title} — ${task.status}${anomaly ? `, ${anomaly}` : ""}, agent: ${agentName}, ${task.start_date ?? "no start"} to ${task.due_date ?? "no due date"}`}
                          onClick={() => setEditingTask(task)}
                          style={{ ...style, position: "absolute", left: sx, top: barTop, width: bw }}
                        >
                          {bw > 60 ? task.title : ""}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Shared dep SVG overlay */}
          <svg style={{ position: "absolute", left: labelWidth, top: HEADER_HEIGHT, width: timelineWidth, height: totalContentHeight, overflow: "visible", pointerEvents: "none", zIndex: 1 }}>
            <defs>
              <marker id="dep-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent-blue)" />
              </marker>
            </defs>
            {visibleTasks.map((t) => {
              const deps = taskDepsMap[t.id] ?? [];
              if (!deps.length) return null;
              const dates = getTaskDates(t, milestoneMap);
              const toX = dateToX(dates ? dates.start : new Date(t.created_at).getTime());
              const toY = taskYMap.get(t.id);
              if (toY === undefined) return null;
              return deps.map((depId) => {
                const depTask = visibleTasks.find((d) => d.id === depId);
                if (!depTask) return null;
                const depDates = getTaskDates(depTask, milestoneMap);
                const fromX = dateToX(depDates ? depDates.end : new Date(depTask.created_at).getTime() + 7 * DAY_MS);
                const fromY = taskYMap.get(depId);
                if (fromY === undefined) return null;
                return (
                  <line key={`${depId}->${t.id}`} x1={fromX} y1={fromY} x2={toX} y2={toY} stroke="var(--accent-blue)" strokeWidth={1} strokeOpacity={0.5} strokeDasharray="4,3" markerEnd="url(#dep-arrow)" />
                );
              });
            })}
          </svg>
        </div>
      </div>

      {editingTask && <TaskEditDrawer task={editingTask} onClose={() => setEditingTask(null)} />}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

interface ToolbarProps {
  hideCompleted: boolean; setHideCompleted: (v: boolean) => void;
  showUndated: boolean; setShowUndated: (v: boolean) => void;
  undatedCount: number; clipped: boolean;
}

function Toolbar({ hideCompleted, setHideCompleted, showUndated, setShowUndated, undatedCount, clipped }: ToolbarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", margin: 0, marginRight: "4px" }}>
        Project-Based Execution Timeline
      </h2>

      {undatedCount > 0 && (
        <button onClick={() => setShowUndated(!showUndated)} style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: "4px", padding: "3px 9px", fontSize: "11px", color: "var(--text-muted)", cursor: "pointer" }}>
          {showUndated ? "Hide" : "Show"} {undatedCount} undated
        </button>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
        <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} style={{ accentColor: "var(--accent-blue)", cursor: "pointer" }} />
        Hide Completed
      </label>

      {clipped && (
        <span style={{ fontSize: "11px", color: "var(--accent-yellow)", background: "color-mix(in srgb, var(--accent-yellow) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent-yellow) 25%, transparent)", borderRadius: "4px", padding: "2px 8px" }}>
          Showing first {MAX_DAYS} days
        </span>
      )}

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "14px" }}>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>Status Legend:</span>
        {LEGEND.map(({ status, label }) => (
          <span key={status} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--text-muted)" }}>
            <span className="legend-dot" style={{ background: STATUS_DOT_COLORS[status] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
