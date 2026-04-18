import { cardStyle, sectionHeader } from "../../styles/shared.js";
import type { MilestoneDailyStats, Milestone, Task } from "../../types";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

interface MilestoneProgressCardProps {
  dailyStats: MilestoneDailyStats[];
  openMilestones: Milestone[];
}

export function MilestoneProgressCard({ dailyStats, openMilestones }: MilestoneProgressCardProps) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Milestone Progress {openMilestones.length > 0 ? `(${openMilestones[0].name})` : ""}</div>
      {dailyStats.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {openMilestones.length > 0 ? "No progress data yet. Complete tasks to see progress." : "No open milestones — create a milestone to see progress."}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px" }}>
          {dailyStats.map((d) => (
            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "100%", background: "var(--accent-blue)", borderRadius: "2px",
                height: `${d.completion_pct}%`, minHeight: "2px",
              }} />
              <span style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px" }}>
                {d.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MilestoneOverviewCardProps {
  openMilestones: Milestone[];
  projectTasks: Task[];
}

export function MilestoneOverviewCard({ openMilestones, projectTasks }: MilestoneOverviewCardProps) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Open Milestones Overview</div>
      {openMilestones.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No open milestones. Create a milestone to track progress.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {openMilestones.map((m) => {
            const milestoneTasks = projectTasks.filter((t) => t.milestone_id === m.id);
            const completedCount = milestoneTasks.filter((t) => t.status === "done").length;
            const totalCount = milestoneTasks.length;
            const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
            return (
              <div key={m.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                  <span style={{ color: "var(--text-primary)" }}>{m.name}</span>
                  <span style={{ color: "var(--text-muted)" }}>{completedCount}/{totalCount}</span>
                </div>
                <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-green)", borderRadius: "2px" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
