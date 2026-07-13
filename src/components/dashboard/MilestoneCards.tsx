import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import { EmptyState } from "../EmptyState.js";
import { typeScale } from "../../styles/shared.js";
import { computeBarLayout } from "./milestoneChartGeometry.js";
import type { MilestoneDailyStats, Milestone, Task } from "../../types";

// Axis-extent labels sit at the 11px floor; strip micro's uppercase/tracking
// since these are plain dates, not section labels.
const axisLabelStyle: React.CSSProperties = {
  ...typeScale.micro,
  textTransform: "none",
  letterSpacing: 0,
  color: "var(--text-muted)",
};

interface MilestoneProgressCardProps {
  dailyStats: MilestoneDailyStats[];
  openMilestones: Milestone[];
  selectedMilestoneId: string | null;
  onSelectMilestone: (id: string) => void;
}

export const MilestoneProgressCard = memo(function MilestoneProgressCard({
  dailyStats,
  openMilestones,
  selectedMilestoneId,
  onSelectMilestone,
}: MilestoneProgressCardProps) {
  const effectiveId = selectedMilestoneId ?? openMilestones[0]?.id ?? null;
  const selectedName = openMilestones.find((m) => m.id === effectiveId)?.name ?? openMilestones[0]?.name ?? "";

  // With one open milestone the title already names it; the selector only
  // appears when there's an actual choice to make.
  const selector = openMilestones.length > 1 ? (
    <select
      aria-label="Milestone"
      value={effectiveId ?? ""}
      onChange={(e) => onSelectMilestone(e.target.value)}
      style={{
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        color: "var(--text-primary)",
        fontSize: "12px",
        padding: "2px 6px",
        height: "26px",
        cursor: "pointer",
      }}
    >
      {openMilestones.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  ) : undefined;

  const title = openMilestones.length > 1 ? "Milestone Progress" : `Milestone Progress ${selectedName ? `(${selectedName})` : ""}`;

  return (
    <CardWrapper title={title} action={selector}>
      {dailyStats.length === 0 ? (
        <EmptyState
          message={openMilestones.length > 0 ? "No progress data yet. Complete tasks to see progress." : "No open milestones — create a milestone to see progress."}
        />
      ) : (
        (() => {
          const layout = computeBarLayout(dailyStats.map((d) => d.date));
          const byDate = new Map(dailyStats.map((d) => [d.date, d]));
          return (
            <div>
              {/* True proportional time axis: bars gap/cluster by real date span. */}
              <div style={{ position: "relative", height: "120px" }}>
                {layout.map((b) => (
                  <div
                    key={b.date}
                    title={`${b.date}: ${byDate.get(b.date)!.completion_pct}%`}
                    style={{
                      position: "absolute",
                      left: `${b.leftPct}%`,
                      width: `${b.widthPct}%`,
                      bottom: 0,
                      background: "var(--accent-blue)",
                      borderRadius: "2px",
                      height: `${byDate.get(b.date)!.completion_pct}%`,
                      minHeight: "2px",
                    }}
                  />
                ))}
              </div>
              {/* First / last date labels mark the true axis extent. */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-1)" }}>
                <span style={axisLabelStyle}>{dailyStats[0]?.date.slice(5)}</span>
                <span style={axisLabelStyle}>{dailyStats[dailyStats.length - 1]?.date.slice(5)}</span>
              </div>
            </div>
          );
        })()
      )}
    </CardWrapper>
  );
});

interface MilestoneOverviewCardProps {
  openMilestones: Milestone[];
  projectTasks: Task[];
}

export const MilestoneOverviewCard = memo(function MilestoneOverviewCard({ openMilestones, projectTasks }: MilestoneOverviewCardProps) {
  return (
    <CardWrapper title="Open Milestones Overview">
      {openMilestones.length === 0 ? (
        <EmptyState message="No open milestones. Create a milestone to track progress." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
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
    </CardWrapper>
  );
});
