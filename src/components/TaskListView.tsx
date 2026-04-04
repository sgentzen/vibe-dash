import { useState, useMemo } from "react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { PRIORITY_COLORS } from "../constants/colors.js";
import type { Task, TaskStatus, TaskPriority } from "../types";

type SortField = "title" | "status" | "priority" | "progress" | "due_date" | "estimate" | "created_at";
type SortDir = "asc" | "desc";

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 0, planned: 1, blocked: 2, done: 3 };

export function TaskListView() {
  const { tasks, selectedProjectId, selectedSprintId, searchQuery, agents } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();

  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TaskStatus | "">("");
  const [bulkPriority, setBulkPriority] = useState<TaskPriority | "">("");

  const lowerSearch = searchQuery.toLowerCase();
  const filteredTasks = tasks.filter(
    (t) =>
      t.parent_task_id === null &&
      (selectedProjectId === null || t.project_id === selectedProjectId) &&
      (selectedSprintId === null || t.sprint_id === selectedSprintId) &&
      (!searchQuery || t.title.toLowerCase().includes(lowerSearch) || (t.description ?? "").toLowerCase().includes(lowerSearch))
  );

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title": cmp = a.title.localeCompare(b.title); break;
        case "status": cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]; break;
        case "priority": cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]; break;
        case "progress": cmp = a.progress - b.progress; break;
        case "due_date": cmp = (a.due_date ?? "").localeCompare(b.due_date ?? ""); break;
        case "estimate": cmp = (a.estimate ?? 0) - (b.estimate ?? 0); break;
        case "created_at": cmp = a.created_at.localeCompare(b.created_at); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredTasks, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === sortedTasks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedTasks.map((t) => t.id)));
    }
  }

  async function handleBulkAction() {
    const updates: Record<string, unknown> = {};
    if (bulkStatus) updates.status = bulkStatus;
    if (bulkPriority) updates.priority = bulkPriority;
    if (Object.keys(updates).length === 0 || selected.size === 0) return;

    const result = await api.bulkUpdateTasks([...selected], updates);
    for (const t of result.tasks) {
      dispatch({ type: "WS_EVENT", payload: { type: "task_updated", payload: t } });
    }
    setSelected(new Set());
    setBulkStatus("");
    setBulkPriority("");
  }

  const sortIcon = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  const headerStyle: React.CSSProperties = {
    padding: "6px 8px", fontSize: "11px", fontWeight: 600,
    color: "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border)", textAlign: "left",
    userSelect: "none",
  };

  const cellStyle: React.CSSProperties = {
    padding: "6px 8px", fontSize: "12px", color: "var(--text-secondary)",
    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  };

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: "8px", padding: "8px 12px", marginBottom: "12px",
          display: "flex", alignItems: "center", gap: "10px", fontSize: "12px",
        }}>
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{selected.size} selected</span>
          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as TaskStatus | "")}
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-primary)", padding: "2px 6px", fontSize: "11px" }}>
            <option value="">Status...</option>
            <option value="planned">Planned</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
          <select value={bulkPriority} onChange={(e) => setBulkPriority(e.target.value as TaskPriority | "")}
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "4px", color: "var(--text-primary)", padding: "2px 6px", fontSize: "11px" }}>
            <option value="">Priority...</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button onClick={handleBulkAction} disabled={!bulkStatus && !bulkPriority}
            style={{ background: "transparent", border: "1px solid var(--accent-blue)", color: "var(--accent-blue)", borderRadius: "4px", padding: "2px 10px", fontSize: "11px", cursor: "pointer" }}>
            Apply
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "11px", cursor: "pointer" }}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...headerStyle, width: "30px" }}>
              <input type="checkbox" checked={selected.size === sortedTasks.length && sortedTasks.length > 0}
                onChange={toggleAll} />
            </th>
            <th style={{ ...headerStyle, minWidth: "200px" }} onClick={() => toggleSort("title")}>Title{sortIcon("title")}</th>
            <th style={headerStyle} onClick={() => toggleSort("status")}>Status{sortIcon("status")}</th>
            <th style={headerStyle} onClick={() => toggleSort("priority")}>Priority{sortIcon("priority")}</th>
            <th style={headerStyle} onClick={() => toggleSort("estimate")}>Est{sortIcon("estimate")}</th>
            <th style={headerStyle} onClick={() => toggleSort("progress")}>Progress{sortIcon("progress")}</th>
            <th style={headerStyle} onClick={() => toggleSort("due_date")}>Due{sortIcon("due_date")}</th>
            <th style={headerStyle}>Agent</th>
          </tr>
        </thead>
        <tbody>
          {sortedTasks.map((task) => {
            const agent = agents.find((a) => a.id === task.assigned_agent_id);
            return (
              <tr key={task.id} style={{ background: selected.has(task.id) ? "rgba(99,102,241,0.05)" : "transparent" }}>
                <td style={cellStyle}>
                  <input type="checkbox" checked={selected.has(task.id)} onChange={() => toggleSelect(task.id)} />
                </td>
                <td style={{ ...cellStyle, color: "var(--text-primary)", fontWeight: 500, maxWidth: "300px" }}>{task.title}</td>
                <td style={cellStyle}>{task.status}</td>
                <td style={{ ...cellStyle, color: PRIORITY_COLORS[task.priority] }}>{task.priority}</td>
                <td style={cellStyle}>{task.estimate ?? "-"}</td>
                <td style={cellStyle}>{task.progress}%</td>
                <td style={cellStyle}>{task.due_date ?? "-"}</td>
                <td style={cellStyle}>{agent?.name ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sortedTasks.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "40px", fontSize: "13px" }}>
          No tasks match the current filters
        </div>
      )}
    </div>
  );
}
