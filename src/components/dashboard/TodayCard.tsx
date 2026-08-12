import type { CSSProperties } from "react";
import { cardStyle, sectionHeader } from "../../styles/shared.js";
import { CountBadge } from "./CountBadge";

interface TodayCardProps {
  spendToday: number;
  /**
   * Count of today's rows with tokens recorded but no cost, because the
   * model is not in the price table. Optional so an older server that does
   * not yet send this field degrades to no badge rather than a crash.
   */
  spendTodayUnpriced?: number;
  tasksCompletedToday: number;
  activeAgents: number;
}

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  padding: "10px 0",
  borderBottom: "1px solid var(--border)",
};

const numStyle: CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "var(--text-primary)",
};

const labelStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "12px",
};

/** Wording shared by the badge and its tooltip, so the two cannot drift apart. */
function unpricedTodayTitle(count: number): string {
  return (
    `${count} of today's entries have tokens recorded but no cost, because the model ` +
    `is not in the price table. Nothing went wrong: this figure is a floor, not the whole amount.`
  );
}

export function TodayCard({ spendToday, spendTodayUnpriced, tasksCompletedToday, activeAgents }: Readonly<TodayCardProps>) {
  return (
    <div style={cardStyle}>
      <div style={{ ...sectionHeader, display: "flex", justifyContent: "space-between" }}>
        <span>Today</span>
        <span style={labelStyle}>since midnight</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Spend</span>
        <span style={numStyle}>
          ${spendToday.toFixed(2)}
          <span style={{ fontFamily: "initial", fontSize: "11px", fontWeight: 400 }}>
            <CountBadge
              count={spendTodayUnpriced}
              label="unpriced"
              explanation={unpricedTodayTitle(spendTodayUnpriced ?? 0)}
              tone="var(--text-muted)"
            />
          </span>
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Tasks done</span>
        <span style={{ ...numStyle, color: "var(--status-success)" }}>{tasksCompletedToday}</span>
      </div>
      <div style={{ ...rowStyle, borderBottom: "none" }}>
        <span style={labelStyle}>Active agents</span>
        <span style={numStyle}>{activeAgents}</span>
      </div>
    </div>
  );
}
