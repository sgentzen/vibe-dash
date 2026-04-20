import type { Milestone, Task } from "../../types";

interface Props {
  milestones: Milestone[];
  tasks: Task[];
  activeProjectId: string | null;
}

function barColor(pct: number): string {
  if (pct >= 0.9) return "var(--accent-green)";
  if (pct >= 0.5) return "var(--accent-blue)";
  if (pct > 0) return "var(--accent-yellow)";
  return "var(--bg-tertiary)";
}

export function MilestoneProgressPanel({ milestones, tasks, activeProjectId }: Props) {
  const filtered = activeProjectId
    ? milestones.filter((m) => m.project_id === activeProjectId)
    : milestones;

  const open = filtered.filter((m) => m.status === "open");
  const achieved = filtered.filter((m) => m.status === "achieved");
  const ordered = [...open, ...achieved];

  const tasksByMilestone = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.milestone_id) {
      const arr = tasksByMilestone.get(t.milestone_id) ?? [];
      arr.push(t);
      tasksByMilestone.set(t.milestone_id, arr);
    }
  }

  const activeName = open[0]?.name ?? null;

  return (
    <div className="orch-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
        <div className="orch-section-header" style={{ marginBottom: 0 }}>Milestone Progress</div>
        {activeName && (
          <span style={{ fontSize: "10px", color: "var(--text-muted)", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeName}
          </span>
        )}
      </div>

      {ordered.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "16px 0" }}>
          No milestones yet
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {ordered.map((m) => {
            const mTasks = tasksByMilestone.get(m.id) ?? [];
            const done = mTasks.filter((t) => t.status === "done").length;
            const total = mTasks.length;
            const pct = total > 0 ? done / total : 0;
            const color = barColor(pct);
            const isDone = m.status === "achieved";

            return (
              <div key={m.id}>
                {/* Parent tasks grouped under milestone */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    opacity: isDone ? 0.55 : 1,
                  }}
                >
                  <span style={{
                    fontSize: "13px",
                    color: "var(--text-primary)",
                    minWidth: 0,
                    flex: "0 0 auto",
                    maxWidth: "40%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {m.name}
                  </span>
                  <div style={{ flex: 1, position: "relative" }}>
                    <div className="orch-progress-bar-track">
                      <div
                        className="orch-progress-bar-fill"
                        style={{ width: `${pct * 100}%`, background: color }}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {done}/{total}
                  </span>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
