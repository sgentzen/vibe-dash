import { cardStyle, sectionHeader } from "../../styles/shared.js";
import type { MilestoneDailyStats, ActivityHeatmapEntry, AgentContribution, Milestone } from "../../types";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

export function MilestoneProgressCard({ dailyStats, openMilestones }: { dailyStats: MilestoneDailyStats[]; openMilestones: Milestone[] }) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Milestone Progress {openMilestones.length > 0 ? `(${openMilestones[0].name})` : ""}</div>
      {dailyStats.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {openMilestones.length > 0 ? "No progress data yet. Complete tasks to see progress." : "No open milestones — create a milestone to see progress."}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px" }}>
          {dailyStats.map((d) => {
            const pct = d.completion_pct;
            return (
              <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  width: "100%", background: "var(--accent-blue)", borderRadius: "2px",
                  height: `${pct}%`, minHeight: "2px",
                }} />
                <span style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px" }}>
                  {d.date.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MilestoneOverviewCard({ openMilestones, projectTasks }: { openMilestones: Milestone[]; projectTasks: { id: string; milestone_id: string | null; status: string }[] }) {
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

export function ContributionsCard({ contributions, openMilestones }: { contributions: AgentContribution[]; openMilestones: Milestone[] }) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Agent Contributions {openMilestones.length > 0 ? `(${openMilestones[0].name})` : ""}</div>
      {contributions.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {openMilestones.length > 0 ? "No contributions yet." : "No open milestones — create a milestone to track agent contributions."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {contributions.map((c) => (
            <div key={c.agent_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-primary)" }}>{c.agent_name}</span>
              <span style={{ color: "var(--text-muted)" }}>
                {c.completed_count} tasks
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HeatmapCard({ heatmap }: { heatmap: ActivityHeatmapEntry[] }) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Activity Heatmap (by hour)</div>
      {heatmap.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No activity data yet.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
          {(() => {
            const hourTotals = Array.from({ length: 24 }, (_, h) =>
              heatmap.filter((e) => e.hour === h).reduce((sum, e) => sum + e.count, 0)
            );
            const maxTotal = Math.max(...hourTotals, 1);
            return Array.from({ length: 24 }, (_, h) => {
              const total = hourTotals[h];
              const intensity = total / maxTotal;
              return (
                <div
                  key={h}
                  title={`${h}:00 - ${total} activities`}
                  style={{
                    width: "20px", height: "20px", borderRadius: "3px",
                    background: total === 0 ? "var(--bg-tertiary)" : `rgba(99, 102, 241, ${0.2 + intensity * 0.8})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "8px", color: intensity > 0.5 ? "var(--text-on-accent)" : "var(--text-muted)",
                  }}
                >
                  {h}
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
