import { useEffect, useState } from "react";
import { useDataState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { typeScale } from "../styles/shared.js";
import type { TaskWorktree, WorktreeStatus } from "../types";

const STATUS_COLORS: Record<WorktreeStatus, string> = {
  active: "var(--accent-green)",
  merged: "var(--accent-blue, #6366f1)",
  abandoned: "var(--accent-yellow)",
  removed: "var(--text-muted)",
};

const STATUS_LABELS: Record<WorktreeStatus, string> = {
  active: "Active",
  merged: "Merged",
  abandoned: "Abandoned",
  removed: "Removed",
};

function StatusBadge({ status }: { status: WorktreeStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "10px",
        fontSize: "11px",
        fontWeight: 600,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function WorktreeCard({
  worktree,
  taskTitle,
  onStatusChange,
}: {
  worktree: TaskWorktree;
  taskTitle: string | undefined;
  onStatusChange: (id: string, status: WorktreeStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const TRANSITIONS: WorktreeStatus[] = worktree.status === "active"
    ? ["merged", "abandoned", "removed"]
    : [];

  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <StatusBadge status={worktree.status} />
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "13px",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={worktree.branch_name}
          >
            {worktree.branch_name}
          </span>
        </div>
        {TRANSITIONS.length > 0 && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={open}
              style={{
                padding: "4px 10px",
                borderRadius: "5px",
                border: "1px solid var(--border)",
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Update ▾
            </button>
            {open && (
              <ul
                role="listbox"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "4px",
                  margin: 0,
                  listStyle: "none",
                  zIndex: 100,
                  minWidth: "120px",
                }}
              >
                {TRANSITIONS.map((s) => (
                  <li
                    key={s}
                    role="option"
                    aria-selected={worktree.status === s}
                    onClick={() => {
                      setOpen(false);
                      onStatusChange(worktree.id, s);
                    }}
                    style={{
                      padding: "6px 10px",
                      cursor: "pointer",
                      borderRadius: "4px",
                      fontSize: "12px",
                      color: STATUS_COLORS[s],
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-tertiary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    Mark as {STATUS_LABELS[s]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {taskTitle && (
        <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Task: <span style={{ color: "var(--text-primary)" }}>{taskTitle}</span>
        </div>
      )}

      <div style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", gap: "16px", flexWrap: "wrap" }}>
        <span title={worktree.worktree_path}>
          Path: <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{worktree.worktree_path.split(/[/\\]/).slice(-2).join("/")}</code>
        </span>
        <span>Created: {new Date(worktree.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

export function WorktreeView() {
  const { worktrees, tasks } = useDataState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.getWorktrees()
      .then((data) => dispatch({ type: "SET_WORKTREES", payload: data }))
      .catch(() => setError("Failed to load worktrees"))
      .finally(() => setLoading(false));
  }, [api, dispatch]);

  async function handleStatusChange(id: string, status: WorktreeStatus) {
    try {
      const updated = await api.updateWorktreeStatus(id, status);
      dispatch({ type: "WS_EVENT", payload: { type: "worktree_updated", payload: updated } });
    } catch {
      setError("Failed to update worktree status");
    }
  }

  const taskTitleMap = Object.fromEntries(tasks.map((t) => [t.id, t.title]));

  const active = worktrees.filter((w) => w.status === "active");
  const inactive = worktrees.filter((w) => w.status !== "active");

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-5)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-5)" }}>
        <h2 style={{ ...typeScale.h2, color: "var(--text-primary)", margin: 0 }}>
          Git Worktrees
        </h2>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {active.length} active
        </span>
      </div>

      {error && (
        <div style={{ color: "var(--accent-red)", fontSize: "13px", marginBottom: "12px" }}>{error}</div>
      )}

      {loading && worktrees.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading…</div>
      )}

      {!loading && worktrees.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "32px", textAlign: "center" }}>
          No worktrees yet. Use the MCP <code>create_worktree</code> tool to create one.
        </div>
      )}

      {active.length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <h3 style={{ ...typeScale.micro, color: "var(--text-muted)", margin: "0 0 var(--space-2) 0" }}>
            Active ({active.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {active.map((wt) => (
              <WorktreeCard
                key={wt.id}
                worktree={wt}
                taskTitle={taskTitleMap[wt.task_id]}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </section>
      )}

      {inactive.length > 0 && (
        <section>
          <h3 style={{ ...typeScale.micro, color: "var(--text-muted)", margin: "0 0 var(--space-2) 0" }}>
            Closed ({inactive.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {inactive.map((wt) => (
              <WorktreeCard
                key={wt.id}
                worktree={wt}
                taskTitle={taskTitleMap[wt.task_id]}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
