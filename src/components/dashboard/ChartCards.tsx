import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import type { SprintDailyStats, VelocityData, ActivityHeatmapEntry, AgentContribution, Sprint } from "../../types";

export const BurndownCard = memo(function BurndownCard({ burndown, activeSprint }: { burndown: SprintDailyStats[]; activeSprint?: Sprint }) {
  return (
    <CardWrapper title={`Sprint Burndown ${activeSprint ? `(${activeSprint.name})` : ""}`}>
      {burndown.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {activeSprint ? "No burndown data yet. Complete tasks to see progress." : "No active sprint — create and activate a sprint to see burndown."}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px" }}>
          {burndown.map((d) => {
            const total = d.completed_tasks + d.remaining_tasks;
            const pct = total > 0 ? (d.remaining_tasks / total) * 100 : 0;
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

export const VelocityCard = memo(function VelocityCard({ velocity }: { velocity: VelocityData[] }) {
  return (
    <CardWrapper title={`Velocity Trend (Last ${velocity.length} Sprints)`}>
      {velocity.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>Complete at least one sprint to see velocity trends.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "120px" }}>
          {(() => { const maxPts = Math.max(...velocity.map((x) => x.completed_points), 1); return velocity.map((v) => {
            const pct = (v.completed_points / maxPts) * 100;
            return (
              <div key={v.sprint_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span style={{ fontSize: "10px", color: "var(--accent-green)", fontWeight: 600 }}>{v.completed_points}pt</span>
                <div style={{
                  width: "100%", background: "var(--accent-green)", borderRadius: "2px",
                  height: `${pct}%`, minHeight: "2px", marginTop: "4px",
                }} />
                <span style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "60px" }}>
                  {v.sprint_name}
                </span>
              </div>
            );
          }); })()}
        </div>
      )}
    </CardWrapper>
  );
});

export const ContributionsCard = memo(function ContributionsCard({ contributions, activeSprint }: { contributions: AgentContribution[]; activeSprint?: Sprint }) {
  return (
    <CardWrapper title={`Agent Contributions ${activeSprint ? `(${activeSprint.name})` : ""}`}>
      {contributions.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
          {activeSprint ? "No contributions yet." : "No active sprint — activate a sprint to track agent contributions."}
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
