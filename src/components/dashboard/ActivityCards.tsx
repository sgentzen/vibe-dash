import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import type { AgentContribution, ActivityHeatmapEntry, Milestone } from "../../types";

interface AgentContributionsCardProps {
  contributions: AgentContribution[];
  openMilestones: Milestone[];
}

export const AgentContributionsCard = memo(function AgentContributionsCard({ contributions, openMilestones }: AgentContributionsCardProps) {
  return (
    <CardWrapper title={`Agent Contributions ${openMilestones.length > 0 ? `(${openMilestones[0].name})` : ""}`}>
      {contributions.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {openMilestones.length > 0 ? "No contributions yet." : "No open milestones — create a milestone to track agent contributions."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {contributions.map((c) => (
            <div key={c.agent_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-primary)" }}>{c.agent_name}</span>
              <span style={{ color: "var(--text-muted)" }}>{c.completed_count} tasks</span>
            </div>
          ))}
        </div>
      )}
    </CardWrapper>
  );
});

interface ActivityHeatmapCardProps {
  heatmap: ActivityHeatmapEntry[];
}

export const ActivityHeatmapCard = memo(function ActivityHeatmapCard({ heatmap }: ActivityHeatmapCardProps) {
  const hourTotals = Array.from({ length: 24 }, (_, h) =>
    heatmap.filter((e) => e.hour === h).reduce((sum, e) => sum + e.count, 0)
  );
  const maxTotal = Math.max(...hourTotals, 1);

  return (
    <CardWrapper title="Activity Heatmap (by hour)">
      {heatmap.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No activity data yet.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
          {Array.from({ length: 24 }, (_, h) => {
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
          })}
        </div>
      )}
    </CardWrapper>
  );
});
