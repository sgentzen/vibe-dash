import { memo } from "react";
import { Sparkline } from "../Sparkline.js";
import { typeScale } from "../../styles/shared.js";

export const KpiCard = memo(function KpiCard({
  label,
  value,
  color,
  sparkline,
}: {
  label: string;
  value: string;
  color: string;
  sparkline?: number[];
}) {
  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      padding: "var(--space-3)",
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "var(--space-1)",
    }}>
      <div style={{ ...typeScale.h1, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ ...typeScale.micro, color: "var(--text-muted)" }}>{label}</div>
      {sparkline && sparkline.length >= 2 && (
        <Sparkline values={sparkline} width={60} height={16} color={color} />
      )}
    </div>
  );
});

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
