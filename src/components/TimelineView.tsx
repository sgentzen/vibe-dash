import { useCallback, useMemo, useState } from "react";
import { useAppState } from "../store";
import type { Milestone, Project, Task } from "../types";
import {
  DAY_MS,
  DEFAULT_LABEL_WIDTH,
  GROUP_HEADER_HEIGHT,
  HEADER_HEIGHT,
  MAX_LABEL_WIDTH,
  MIN_LABEL_WIDTH,
  MONTH_HEADER_HEIGHT,
  ROW_HEIGHT,
  STATUS_DOT_COLORS,
} from "./timeline/constants";
import { buildGroups, getTaskDates, type TaskGroup } from "./timeline/utils";
import { DateHeader } from "./timeline/DateHeader";
import { GroupHeaderRow } from "./timeline/GroupHeaderRow";
import { TaskRow } from "./timeline/TaskRow";
import { TaskEditDrawer } from "./TaskEditDrawer";

const MAX_DAYS = 60;

const LEGEND: { status: keyof typeof STATUS_DOT_COLORS; label: string }[] = [
  { status: "in_progress", label: "In progress" },
  { status: "planned", label: "Planned" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

export function TimelineView() {
  const { tasks, milestones, projects, selectedProjectId, selectedMilestoneId, blockers, taskDepsMap } =
    useAppState();
  const [showUndated, setShowUndated] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const milestoneMap = useMemo(() => {
    const m = new Map<string, Milestone>();
    for (const s of milestones) m.set(s.id, s);
    return m;
  }, [milestones]);

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const allMatchingTasks = tasks.filter(
    (t) =>
      t.parent_task_id === null &&
      (selectedProjectId === null || t.project_id === selectedProjectId) &&
      (selectedMilestoneId === null || t.milestone_id === selectedMilestoneId),
  );

  const withoutCompleted = hideCompleted
    ? allMatchingTasks.filter((t) => t.status !== "done")
    : allMatchingTasks;

  const datedTasks = withoutCompleted.filter((t) => getTaskDates(t, milestoneMap) !== null);
  const undatedCount = withoutCompleted.length - datedTasks.length;
  const activeTasks = showUndated ? withoutCompleted : datedTasks;

  const completedCount = allMatchingTasks.filter((t) => t.status === "done").length;
  const allDone = allMatchingTasks.length > 0 && completedCount === allMatchingTasks.length;

  const sortedTasks = useMemo(() => {
    return [...activeTasks].sort((a, b) => {
      const aDates = getTaskDates(a, milestoneMap);
      const bDates = getTaskDates(b, milestoneMap);
      if (aDates && !bDates) return -1;
      if (!aDates && bDates) return 1;
      const aStart = aDates ? aDates.start : new Date(a.created_at).getTime();
      const bStart = bDates ? bDates.start : new Date(b.created_at).getTime();
      return aStart - bStart;
    });
  }, [activeTasks, milestoneMap]);

  const groups = useMemo(
    () => buildGroups(sortedTasks, milestoneMap, projectMap),
    [sortedTasks, milestoneMap, projectMap],
  );

  const flatRows = useMemo(() => {
    const rows: ({ type: "group"; group: TaskGroup } | { type: "task"; task: Task })[] = [];
    for (const g of groups) {
      rows.push({ type: "group", group: g });
      if (!collapsedGroups.has(g.key)) {
        for (const t of g.tasks) {
          rows.push({ type: "task", task: t });
        }
      }
    }
    return rows;
  }, [groups, collapsedGroups]);

  const visibleTasks = useMemo(
    () => flatRows.filter((r): r is { type: "task"; task: Task } => r.type === "task").map((r) => r.task),
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
    return {
      minDate: new Date(min),
      maxDate: new Date(clampedMax),
      totalDays: clipped ? MAX_DAYS : days,
      clipped,
    };
  }, [visibleTasks, milestoneMap]);

  const timelineWidth = Math.max(totalDays * 30, 600);

  const dateToX = useCallback(
    (timeMs: number): number => {
      return ((timeMs - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * timelineWidth;
    },
    [minDate, maxDate, timelineWidth],
  );

  const activeMilestones = milestones.filter(
    (m) => (selectedProjectId === null || m.project_id === selectedProjectId) && m.target_date,
  );

  const handleResize = useCallback((delta: number) => {
    setLabelWidth((w) => Math.max(MIN_LABEL_WIDTH, Math.min(MAX_LABEL_WIDTH, w + delta)));
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const totalContentHeight = useMemo(() => {
    let h = 0;
    for (const r of flatRows) {
      h += r.type === "group" ? GROUP_HEADER_HEIGHT : ROW_HEIGHT;
    }
    return h;
  }, [flatRows]);

  // Monday lines in the timeline track
  const mondayLines = useMemo(() => {
    const lines: number[] = [];
    const start = new Date(minDate);
    // Seek back to the nearest Monday on or before minDate
    const day = start.getDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = (day + 6) % 7; // 0 when already Monday
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

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <h2 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600, margin: 0, marginRight: "4px" }}>
          Timeline
        </h2>

        {undatedCount > 0 && (
          <button
            onClick={() => setShowUndated(!showUndated)}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              padding: "3px 9px",
              fontSize: "11px",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {showUndated ? "Hide" : "Show"} {undatedCount} undated
          </button>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--text-muted)", cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
            style={{ accentColor: "var(--accent-blue)", cursor: "pointer" }}
          />
          Hide completed
        </label>

        {clipped && (
          <span style={{
            fontSize: "11px",
            color: "var(--accent-yellow)",
            background: "color-mix(in srgb, var(--accent-yellow) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent-yellow) 25%, transparent)",
            borderRadius: "4px",
            padding: "2px 8px",
          }}>
            Showing first {MAX_DAYS} days
          </span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
          {LEGEND.map(({ status, label }) => (
            <span key={status} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "var(--text-muted)" }}>
              <span className="legend-dot" style={{ background: STATUS_DOT_COLORS[status] }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Empty states */}
      {sortedTasks.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>
          {allDone && hideCompleted ? (
            <div>
              <div style={{ fontSize: "18px", marginBottom: "8px" }}>All tasks complete</div>
              <div style={{ fontSize: "12px" }}>
                <button
                  onClick={() => setHideCompleted(false)}
                  style={{ background: "transparent", border: "none", color: "var(--accent-blue)", cursor: "pointer", fontSize: "12px", padding: 0 }}
                >
                  Show {completedCount} completed task{completedCount !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          ) : undatedCount > 0 && datedTasks.length === 0 ? (
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
            <>
              No tasks to display.
              {undatedCount > 0 ? ` ${undatedCount} tasks have no dates set.` : ""}
            </>
          )}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{ position: "relative", minWidth: labelWidth + timelineWidth + 20 }}>
            {/* Date header */}
            <DateHeader
              minDate={minDate}
              totalDays={totalDays}
              timelineWidth={timelineWidth}
              labelWidth={labelWidth}
            />

            {/* Week vertical rules */}
            {mondayLines.map((x, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: labelWidth + x,
                  top: MONTH_HEADER_HEIGHT,
                  width: 1,
                  height: HEADER_HEIGHT - MONTH_HEADER_HEIGHT + totalContentHeight,
                  background: "var(--border)",
                  opacity: 0.35,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              />
            ))}

            {/* Milestone boundary lines */}
            {activeMilestones.map((m) => {
              if (!m.target_date) return null;
              const targetX = dateToX(new Date(m.target_date).getTime());
              if (targetX < 0 || targetX > timelineWidth) return null;
              return (
                <div
                  key={m.id}
                  style={{
                    position: "absolute",
                    left: labelWidth + targetX,
                    top: HEADER_HEIGHT,
                    width: 2,
                    height: totalContentHeight,
                    background: "var(--accent-purple)",
                    zIndex: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: -16,
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--accent-purple)",
                      whiteSpace: "nowrap",
                      left: 6,
                    }}
                  >
                    {m.name}
                  </span>
                </div>
              );
            })}

            {/* Today marker with triangle cap */}
            {todayVisible && (
              <div
                style={{
                  position: "absolute",
                  left: labelWidth + todayX,
                  top: 0,
                  width: "2px",
                  height: HEADER_HEIGHT + totalContentHeight,
                  background: "var(--accent-red)",
                  zIndex: 2,
                  pointerEvents: "none",
                }}
              >
                {/* Triangle cap */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 0,
                  height: 0,
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: "6px solid var(--accent-red)",
                }} />
                <span
                  style={{
                    position: "absolute",
                    top: "8px",
                    left: "4px",
                    fontSize: "11px",
                    color: "var(--accent-red)",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  Today
                </span>
              </div>
            )}

            {/* Grouped rows */}
            {flatRows.map((row) => {
              if (row.type === "group") {
                return (
                  <GroupHeaderRow
                    key={row.group.key}
                    group={row.group}
                    collapsed={collapsedGroups.has(row.group.key)}
                    onToggle={() => toggleGroup(row.group.key)}
                    labelWidth={labelWidth}
                    timelineWidth={timelineWidth}
                  />
                );
              }

              return (
                <TaskRow
                  key={row.task.id}
                  task={row.task}
                  labelWidth={labelWidth}
                  timelineWidth={timelineWidth}
                  milestoneMap={milestoneMap}
                  dateToX={dateToX}
                  onResize={handleResize}
                  blockers={blockers}
                  onBarClick={setEditingTask}
                />
              );
            })}

            {/* Shared dependency SVG overlay */}
            <svg
              style={{
                position: "absolute",
                left: labelWidth,
                top: HEADER_HEIGHT,
                width: timelineWidth,
                height: totalContentHeight,
                overflow: "visible",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              <defs>
                <marker id="dep-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent-blue)" />
                </marker>
              </defs>
              {(() => {
                const lines: React.ReactNode[] = [];
                let yOffset = 0;
                const taskY = new Map<string, number>();
                for (const r of flatRows) {
                  if (r.type === "group") {
                    yOffset += GROUP_HEADER_HEIGHT;
                  } else {
                    taskY.set(r.task.id, yOffset + ROW_HEIGHT / 2);
                    yOffset += ROW_HEIGHT;
                  }
                }
                for (const r of flatRows) {
                  if (r.type !== "task") continue;
                  const t = r.task;
                  const deps = taskDepsMap[t.id] ?? [];
                  if (deps.length === 0) continue;
                  const dates = getTaskDates(t, milestoneMap);
                  const startMs = dates ? dates.start : new Date(t.created_at).getTime();
                  const toX = dateToX(startMs);
                  const toY = taskY.get(t.id);
                  if (toY === undefined) continue;
                  for (const depId of deps) {
                    const depTask = visibleTasks.find((d) => d.id === depId);
                    if (!depTask) continue;
                    const depDates = getTaskDates(depTask, milestoneMap);
                    const depEndMs = depDates ? depDates.end : new Date(depTask.created_at).getTime() + 7 * DAY_MS;
                    const fromX = dateToX(depEndMs);
                    const fromY = taskY.get(depId);
                    if (fromY === undefined) continue;
                    lines.push(
                      <line
                        key={`${depId}->${t.id}`}
                        x1={fromX} y1={fromY}
                        x2={toX} y2={toY}
                        stroke="var(--accent-blue)"
                        strokeWidth={1}
                        strokeOpacity={0.5}
                        strokeDasharray="4,3"
                        markerEnd="url(#dep-arrow)"
                      />
                    );
                  }
                }
                return lines;
              })()}
            </svg>
          </div>
        </div>
      )}

      {editingTask && (
        <TaskEditDrawer task={editingTask} onClose={() => setEditingTask(null)} />
      )}
    </div>
  );
}
