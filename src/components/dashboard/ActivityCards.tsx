import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import { EmptyState } from "../EmptyState.js";
import type { ActivityHeatmapEntry } from "../../types";

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
        <EmptyState message="No activity data yet." />
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
