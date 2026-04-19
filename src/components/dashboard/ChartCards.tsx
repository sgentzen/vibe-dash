import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import type { MilestoneDailyStats, ActivityHeatmapEntry, AgentContribution, Milestone } from "../../types";

export const BurndownCard = memo(function BurndownCard({ burndown, activeMilestone }: { burndown: MilestoneDailyStats[]; activeMilestone?: Milestone }) {
  return (
    <CardWrapper title={`Milestone Burndown ${activeMilestone ? `(${activeMilestone.name})` : ""}`}>
      {burndown.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {activeMilestone ? "No burndown data yet. Complete tasks to see progress." : "No active milestone — create and activate a milestone to see burndown."}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px" }}>
          {burndown.map((d) => {
            const remaining = d.total_tasks - d.completed_tasks;
            const pct = d.total_tasks > 0 ? (remaining / d.total_tasks) * 100 : 0;
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
    </CardWrapper>
  );
});

export const ContributionsCard = memo(function ContributionsCard({ contributions, activeMilestone }: { contributions: AgentContribution[]; activeMilestone?: Milestone }) {
  return (
    <CardWrapper title={`Agent Contributions ${activeMilestone ? `(${activeMilestone.name})` : ""}`}>
      {contributions.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {activeMilestone ? "No contributions yet." : "No active milestone — activate a milestone to track agent contributions."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {contributions.map((c) => (
            <div key={c.agent_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-primary)" }}>{c.agent_name}</span>
              <span style={{ color: "var(--text-muted)" }}>
                {c.completed_count} tasks ({c.completed_points}pt)
              </span>
            </div>
          ))}
        </div>
      )}
    </CardWrapper>
  );
});

export const HeatmapCard = memo(function HeatmapCard({ heatmap }: { heatmap: ActivityHeatmapEntry[] }) {
  return (
    <CardWrapper title="Activity Heatmap (by hour)">
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
    </CardWrapper>
  );
});
