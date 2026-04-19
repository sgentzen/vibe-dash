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
  ROW_HEIGHT,
} from "./timeline/constants";
import { buildGroups, getTaskDates, type TaskGroup } from "./timeline/utils";
import { DateHeader } from "./timeline/DateHeader";
import { GroupHeaderRow } from "./timeline/GroupHeaderRow";
import { TaskRow } from "./timeline/TaskRow";

export function TimelineView() {
  const { tasks, milestones, projects, selectedProjectId, selectedMilestoneId, taskDepsMap } =
    useAppState();
  const [showUndated, setShowUndated] = useState(false);
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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

  const datedTasks = allMatchingTasks.filter((t) => getTaskDates(t, milestoneMap) !== null);
  const undatedCount = allMatchingTasks.length - datedTasks.length;
  const activeTasks = showUndated ? allMatchingTasks : datedTasks;

  // Sort tasks by start date
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

  // Group tasks
  const groups = useMemo(
    () => buildGroups(sortedTasks, milestoneMap, projectMap),
    [sortedTasks, milestoneMap, projectMap],
  );

  // Build flat render list (group headers + visible task rows) for positioning
  const flatRows = useMemo(() => {
    const rows: { type: "group"; group: TaskGroup }[] | { type: "task"; task: Task }[] = [];
    for (const g of groups) {
      (rows as { type: "group"; group: TaskGroup }[]).push({ type: "group", group: g });
      if (!collapsedGroups.has(g.key)) {
        for (const t of g.tasks) {
          (rows as { type: "task"; task: Task }[]).push({ type: "task", task: t });
        }
      }
    }
    return rows as ({ type: "group"; group: TaskGroup } | { type: "task"; task: Task })[];
  }, [groups, collapsedGroups]);

  // Visible tasks only (for date range calculation)
  const visibleTasks = useMemo(
    () => flatRows.filter((r): r is { type: "task"; task: Task } => r.type === "task").map((r) => r.task),
    [flatRows],
  );

  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (visibleTasks.length === 0) return { minDate: new Date(), maxDate: new Date(), totalDays: 30 };
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
    return { minDate: new Date(min), maxDate: new Date(max), totalDays: Math.ceil((max - min) / DAY_MS) };
  }, [visibleTasks, milestoneMap]);

  const timelineWidth = Math.max(totalDays * 30, 600);

  const dateToX = useCallback(
    (timeMs: number): number => {
      return ((timeMs - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * timelineWidth;
    },
    [minDate, maxDate, timelineWidth],
  );

  // Milestone boundaries
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

  // Total content height for markers
  const totalContentHeight = useMemo(() => {
    let h = 0;
    for (const r of flatRows) {
      h += r.type === "group" ? GROUP_HEADER_HEIGHT : ROW_HEIGHT;
    }
    return h;
  }, [flatRows]);

  // Build a lookup: task.id → y-offset for dependency arrows
  const taskYMap = useMemo(() => {
    const map = new Map<string, number>();
    let y = 0;
    for (const r of flatRows) {
      if (r.type === "group") {
        y += GROUP_HEADER_HEIGHT;
      } else {
        map.set(r.task.id, y);
        y += ROW_HEIGHT;
      }
    }
    return map;
  }, [flatRows]);

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
              padding: "4px 10px",
              fontSize: "11px",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {showUndated ? "Hide" : "Show"} {undatedCount} undated task{undatedCount !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {sortedTasks.length === 0 ? (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "13px",
            textAlign: "center",
            padding: "40px",
          }}
        >
          {undatedCount > 0 && datedTasks.length === 0 ? (
            <div>
              <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                No tasks have dates set
              </div>
              <div style={{ fontSize: "12px" }}>
                Add start_date and due_date to tasks to build a useful timeline.
                {!showUndated &&
                  ` ${undatedCount} undated task${undatedCount !== 1 ? "s" : ""} hidden.`}
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
            {/* ── Two-tier date header ─────────────────────────────── */}
            <DateHeader
              minDate={minDate}
              totalDays={totalDays}
              timelineWidth={timelineWidth}
              labelWidth={labelWidth}
            />

            {/* ── Milestone boundary lines ────────────────────────── */}
            {activeMilestones.map((m) => {
              if (!m.target_date) return null;
              const targetX = dateToX(new Date(m.target_date).getTime());
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

            {/* ── Today marker ────────────────────────────────────── */}
            {(() => {
              const todayX = dateToX(Date.now());
              if (todayX > 0 && todayX < timelineWidth) {
                return (
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
                    <span
                      style={{
                        position: "absolute",
                        top: "2px",
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
                );
              }
              return null;
            })()}

            {/* ── Grouped rows ────────────────────────────────────── */}
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
                  depIds={taskDepsMap[row.task.id] ?? []}
                  taskYMap={taskYMap}
                  visibleTasks={visibleTasks}
                />
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
