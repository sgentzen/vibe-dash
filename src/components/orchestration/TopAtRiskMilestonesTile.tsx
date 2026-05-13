import { EmptyState } from "../EmptyState.js";
import { useAppDispatch } from "../../store";
import type { MilestoneHealth } from "../../../shared/types.js";
import { StatusPill } from "../StatusPill.js";
import { MILESTONE_HEALTH_TOKEN, tokenToColor } from "../../constants/statusTokens.js";

interface Props {
  /** Server-authoritative milestone health from getExecutiveSummary. */
  health: MilestoneHealth[];
  /** Total open milestone count for the active project (for the header chip). */
  openCount: number;
}

const HEALTH_RANK: Record<MilestoneHealth["health"], number> = {
  behind: 0,
  at_risk: 1,
  on_track: 2,
};

export function TopAtRiskMilestonesTile({ health, openCount }: Props) {
  const dispatch = useAppDispatch();

  // Rank Behind first, then At Risk, then On Track; within a band, lowest progress first.
  const ranked = [...health]
    .sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.completion_pct - b.completion_pct)
    .slice(0, 3);

  const goToExecutive = (milestoneId: string) => {
    dispatch({ type: "SELECT_MILESTONE", payload: milestoneId });
    dispatch({ type: "SET_ACTIVE_VIEW", payload: "executive" });
  };

  return (
    <div className="orch-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
        <div className="orch-section-header" style={{ marginBottom: 0 }}>Top At-Risk Milestones</div>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {openCount} open
        </span>
      </div>

      {ranked.length === 0 ? (
        <EmptyState message="No open milestones" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {ranked.map((m) => {
            const color = tokenToColor(MILESTONE_HEALTH_TOKEN[m.health]);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => goToExecutive(m.id)}
                title={`Open ${m.name} in Executive view`}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginBottom: "5px" }}>
                  <span
                    style={{
                      fontSize: "13px",
                      color: "var(--text-primary)",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {m.name}
                  </span>
                  <StatusPill token={MILESTONE_HEALTH_TOKEN[m.health]} label={labelFor(m.health)} size="sm" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", marginBottom: "5px" }}>
                  <span>{m.completed_count}/{m.task_count} · {m.completion_pct}%</span>
                  {m.target_date && <span>Due {new Date(m.target_date).toLocaleDateString()}</span>}
                </div>
                <div className="orch-progress-bar-track">
                  <div
                    className="orch-progress-bar-fill"
                    style={{ width: `${m.completion_pct}%`, background: color }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelFor(h: MilestoneHealth["health"]): string {
  return h === "on_track" ? "On Track" : h === "at_risk" ? "At Risk" : "Behind";
}
