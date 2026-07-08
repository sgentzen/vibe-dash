import type { CSSProperties } from "react";
import { cardStyle, sectionHeader } from "../../styles/shared.js";

interface TodayCardProps {
  spendToday: number;
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

export function TodayCard({ spendToday, tasksCompletedToday, activeAgents }: Readonly<TodayCardProps>) {
  return (
    <div style={cardStyle}>
      <div style={{ ...sectionHeader, display: "flex", justifyContent: "space-between" }}>
        <span>Today</span>
        <span style={labelStyle}>since midnight</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Spend</span>
        <span style={numStyle}>${spendToday.toFixed(2)}</span>
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
