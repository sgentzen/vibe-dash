import { useCallback, useMemo, useRef, useState } from "react";
import { useAppState } from "../store";
import { PRIORITY_COLORS } from "../constants/colors.js";
import type { Task, Milestone, Project, TaskStatus } from "../types";

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  done: "var(--accent-green)",
  in_progress: "var(--accent-blue)",
  blocked: "var(--accent-yellow)",
  planned: "var(--text-muted)",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_HEIGHT = 24;
const ROW_HEIGHT = 32;
const DEFAULT_LABEL_WIDTH = 320;
const MIN_LABEL_WIDTH = 160;
const MAX_LABEL_WIDTH = 500;
const MONTH_HEADER_HEIGHT = 24;
const WEEK_HEADER_HEIGHT = 22;
const HEADER_HEIGHT = MONTH_HEADER_HEIGHT + WEEK_HEADER_HEIGHT;
const GROUP_HEADER_HEIGHT = 32;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getTaskDates(task: Task, milestoneMap: Map<string, Milestone>): { start: number; end: number } | null {
  const taskStart = task.start_date ? new Date(task.start_date).getTime() : null;
  const taskEnd = task.due_date ? new Date(task.due_date).getTime() : null;

  if (taskStart || taskEnd) {
    const start = taskStart ?? (taskEnd! - 7 * DAY_MS);
    const end = taskEnd ?? (taskStart! + 7 * DAY_MS);
    return { start, end };
  }

  if (task.milestone_id) {
    const milestone = milestoneMap.get(task.milestone_id);
    if (milestone && milestone.target_date) {
      const milestoneDate = new Date(milestone.target_date).getTime();
      const start = milestoneDate - 14 * DAY_MS;
      const end = milestoneDate;
      return { start, end };
    }
  }

  return null;
}

// ─── Group type for milestone/project grouping ─────────────────────────────

interface TaskGroup {
  key: string;
  label: string;
  sublabel: string | null;
  completedCount: number;
  totalCount: number;
  tasks: Task[];
}

function buildGroups(
  tasks: Task[],
  milestoneMap: Map<string, Milestone>,
  projectMap: Map<string, Project>,
): TaskGroup[] {
  // Bucket tasks by milestone first, then by project for un-milestoned tasks
  const milestoneGroups = new Map<string, Task[]>();
  const projectGroups = new Map<string, Task[]>();
  const ungrouped: Task[] = [];

  for (const t of tasks) {
    if (t.milestone_id && milestoneMap.has(t.milestone_id)) {
      const arr = milestoneGroups.get(t.milestone_id) ?? [];
      arr.push(t);
      milestoneGroups.set(t.milestone_id, arr);
    } else if (t.project_id && projectMap.has(t.project_id)) {
      const arr = projectGroups.get(t.project_id) ?? [];
      arr.push(t);
      projectGroups.set(t.project_id, arr);
    } else {
      ungrouped.push(t);
    }
  }

  const groups: TaskGroup[] = [];

  // Milestone groups (sorted by target_date, then name)
  const msEntries = [...milestoneGroups.entries()].sort((a, b) => {
    const mA = milestoneMap.get(a[0])!;
    const mB = milestoneMap.get(b[0])!;
    if (mA.target_date && mB.target_date) return mA.target_date.localeCompare(mB.target_date);
    if (mA.target_date) return -1;
    if (mB.target_date) return 1;
    return mA.name.localeCompare(mB.name);
  });

  for (const [msId, msTasks] of msEntries) {
    const ms = milestoneMap.get(msId)!;
    const proj = projectMap.get(ms.project_id);
    const completed = msTasks.filter((t) => t.status === "done").length;
    groups.push({
      key: `ms-${msId}`,
      label: ms.name,
      sublabel: proj ? proj.name : null,
      completedCount: completed,
      totalCount: msTasks.length,
      tasks: msTasks,
    });
  }

  // Project groups (for tasks with no milestone)
  const projEntries = [...projectGroups.entries()].sort((a, b) => {
    const pA = projectMap.get(a[0])!;
    const pB = projectMap.get(b[0])!;
    return pA.name.localeCompare(pB.name);
  });

  for (const [projId, projTasks] of projEntries) {
    const proj = projectMap.get(projId)!;
    const completed = projTasks.filter((t) => t.status === "done").length;
    groups.push({
      key: `proj-${projId}`,
      label: proj.name,
      sublabel: "No milestone",
      completedCount: completed,
      totalCount: projTasks.length,
      tasks: projTasks,
    });
  }

  // Ungrouped
  if (ungrouped.length > 0) {
    const completed = ungrouped.filter((t) => t.status === "done").length;
    groups.push({
      key: "ungrouped",
      label: "Ungrouped",
      sublabel: null,
      completedCount: completed,
      totalCount: ungrouped.length,
      tasks: ungrouped,
    });
  }

  return groups;
}

// ─── Two-tier date header ──────────────────────────────────────────────────

function DateHeader({
  minDate,
  totalDays,
  timelineWidth,
  labelWidth,
}: {
  minDate: Date;
  totalDays: number;
  timelineWidth: number;
  labelWidth: number;
}) {
  const dayWidth = timelineWidth / totalDays;

  // Build month spans
  const months: { label: string; startDay: number; span: number }[] = [];
  let curMonth = -1;
  let curYear = -1;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate.getTime() + i * DAY_MS);
    const m = d.getUTCMonth();
    const y = d.getUTCFullYear();
    if (m !== curMonth || y !== curYear) {
      months.push({ label: `${MONTH_NAMES[m]} ${y}`, startDay: i, span: 1 });
      curMonth = m;
      curYear = y;
    } else {
      months[months.length - 1].span++;
    }
  }

  // Build week spans — every Monday starts a new week
  const weeks: { label: string; startDay: number; span: number }[] = [];
  let weekStart = 0;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate.getTime() + i * DAY_MS);
    const isMonday = d.getUTCDay() === 1;

    if (isMonday && i > 0) {
      // Close previous week
      weeks.push({
        label: formatWeekLabel(new Date(minDate.getTime() + weekStart * DAY_MS)),
        startDay: weekStart,
        span: i - weekStart,
      });
      weekStart = i;
    }
  }
  // Close final week
  if (weekStart < totalDays) {
    weeks.push({
      label: formatWeekLabel(new Date(minDate.getTime() + weekStart * DAY_MS)),
      startDay: weekStart,
      span: totalDays - weekStart,
    });
  }

  return (
    <div style={{ marginLeft: labelWidth, width: timelineWidth, position: "relative" }}>
      {/* Month row */}
      <div style={{ display: "flex", height: MONTH_HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}>
        {months.map((m, idx) => (
          <div
            key={idx}
            style={{
              width: m.span * dayWidth,
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--text-primary)",
              paddingLeft: "8px",
              display: "flex",
              alignItems: "center",
              borderLeft: idx > 0 ? "2px solid var(--border)" : "none",
              background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {m.span * dayWidth > 40 ? m.label : ""}
          </div>
        ))}
      </div>
      {/* Week row */}
      <div style={{ display: "flex", height: WEEK_HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}>
        {weeks.map((w, idx) => (
          <div
            key={idx}
            style={{
              width: w.span * dayWidth,
              fontSize: "11px",
              fontWeight: 400,
              color: "var(--text-secondary)",
              paddingLeft: "6px",
              display: "flex",
              alignItems: "center",
              borderLeft: "1px solid var(--border-subtle, var(--border))",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {w.span * dayWidth > 32 ? w.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatWeekLabel(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ─── Resize handle ─────────────────────────────────────────────────────────

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastX.current = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        onResize(delta);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onResize],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: "5px",
        cursor: "col-resize",
        zIndex: 10,
        background: "transparent",
      }}
      title="Drag to resize"
    />
  );
}

// ─── Group header row ──────────────────────────────────────────────────────

function GroupHeaderRow({
  group,
  collapsed,
  onToggle,
  labelWidth,
  timelineWidth,
}: {
  group: TaskGroup;
  collapsed: boolean;
  onToggle: () => void;
  labelWidth: number;
  timelineWidth: number;
}) {
  const pct = group.totalCount > 0 ? Math.round((group.completedCount / group.totalCount) * 100) : 0;

  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        height: GROUP_HEADER_HEIGHT,
        cursor: "pointer",
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid var(--border)",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div
        style={{
          width: labelWidth,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 8px",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            transition: "transform 0.15s",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}
        >
          ▼
        </span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {group.label}
        </span>
        {group.sublabel && (
          <span style={{ fontSize: "11px", color: "var(--text-muted)", flexShrink: 0 }}>
            {group.sublabel}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingLeft: "8px",
          width: timelineWidth,
        }}
      >
        {/* Completion bar */}
        <div
          style={{
            width: "80px",
            height: "6px",
            borderRadius: "3px",
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: "3px",
              background: pct === 100 ? "var(--accent-green)" : "var(--accent-purple)",
              transition: "width 0.3s",
            }}
          />
        </div>
        <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          {group.completedCount}/{group.totalCount} ({pct}%)
        </span>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

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

  function dateToX(timeMs: number): number {
    return ((timeMs - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * timelineWidth;
  }

  const statusOpacity: Record<string, number> = {
    done: 0.4,
    blocked: 0.6,
    in_progress: 1,
    planned: 0.8,
  };

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

              const task = row.task;
              const dates = getTaskDates(task, milestoneMap);
              const start = dates ? dates.start : new Date(task.created_at).getTime();
              const end = dates ? dates.end : start + 7 * DAY_MS;
              const startX = dateToX(start);
              const endX = dateToX(end);
              const barWidth = Math.max(endX - startX, 8);
              const color = PRIORITY_COLORS[task.priority] ?? "var(--accent-purple)";
              const opacity = statusOpacity[task.status] ?? 1;
              const hasDates = dates !== null;

              return (
                <div
                  key={task.id}
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
                    <ResizeHandle onResize={handleResize} />
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
                    {(taskDepsMap[task.id] ?? []).map((depId) => {
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
