import type { Milestone, Task } from "../../types";

interface Props {
  milestones: Milestone[];
  tasks: Task[];
}

function barColor(pct: number): string {
  if (pct >= 0.75) return "var(--accent-green)";
  if (pct >= 0.4) return "var(--accent-yellow)";
  return "var(--accent-red)";
}

export function TopAtRiskMilestonesTile({ milestones, tasks }: Props) {
  const open = milestones.filter((m) => m.status === "open");

  const tasksByMilestone = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.milestone_id) {
      const arr = tasksByMilestone.get(t.milestone_id) ?? [];
      arr.push(t);
      tasksByMilestone.set(t.milestone_id, arr);
    }
  }

  // Sort open milestones by completion ascending (lowest = most at risk)
  const ranked = open
    .map((m) => {
      const mTasks = tasksByMilestone.get(m.id) ?? [];
      const done = mTasks.filter((t) => t.status === "done").length;
      const total = mTasks.length;
      const pct = total > 0 ? done / total : 0;
      return { m, done, total, pct };
    })
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  return (
    <div className="orch-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
        <div className="orch-section-header" style={{ marginBottom: 0 }}>Top At-Risk Milestones</div>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {open.length} open
        </span>
      </div>

      {ranked.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "12px 0" }}>
          No open milestones
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {ranked.map(({ m, done, total, pct }) => {
            const color = barColor(pct);
            return (
              <div key={m.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "5px" }}>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "var(--text-primary)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "70%",
                    }}
                    title={m.name}
                  >
                    {m.name}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", flexShrink: 0 }}>
                    {done}/{total}
                  </span>
                </div>
                <div className="orch-progress-bar-track">
                  <div
                    className="orch-progress-bar-fill"
                    style={{ width: `${pct * 100}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
