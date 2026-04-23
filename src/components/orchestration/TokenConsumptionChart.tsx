import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { useAppState } from "../../store";
import type { CostTimeseriesEntry } from "../../hooks/useApi.js";

interface Props {
  activeProjectId: string | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function linearRegression(ys: number[]): number[] {
  const n = ys.length;
  if (n < 2) return ys.slice();
  const xs = ys.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return ys.map(() => sumY / n);
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return xs.map((x) => m * x + b);
}

export function TokenConsumptionChart({ activeProjectId }: Props) {
  const api = useApi();
  const { pollGeneration } = useAppState();
  const [data, setData] = useState<CostTimeseriesEntry[]>([]);

  useEffect(() => {
    const params: Record<string, string | undefined> = { days: "30" };
    if (activeProjectId) params.project_id = activeProjectId;
    api
      .getCostTimeseries(params)
      .then(setData)
      .catch(() => {});
  }, [api, activeProjectId, pollGeneration]);

  const { dailyTotals, trendPct, trendLine, maxTokens } = useMemo(() => {
    if (data.length === 0) return { dailyTotals: [], trendPct: 0, trendLine: [], maxTokens: 0 };

    const dailyTotals = data.map((d) => d.total_input_tokens + d.total_output_tokens);
    const trendLine = linearRegression(dailyTotals);

    const firstNonZero = dailyTotals.find((v) => v > 0) ?? 0;
    const last = dailyTotals[dailyTotals.length - 1] ?? 0;
    const trendPct = firstNonZero > 0 ? Math.round(((last - firstNonZero) / firstNonZero) * 100) : 0;

    const maxTokens = Math.max(...dailyTotals, 1);

    return { dailyTotals, trendPct, trendLine, maxTokens };
  }, [data]);

  const latest = dailyTotals[dailyTotals.length - 1] ?? 0;
  const trendPositive = trendPct >= 0;

  const PAD = 16;
  const W = 280;
  const H = 140;
  const chartW = W - PAD * 2;
  const chartH = H - PAD * 2 - 20; // 20 for x-axis labels

  const toX = (i: number) => PAD + (dailyTotals.length <= 1 ? chartW / 2 : (i / (dailyTotals.length - 1)) * chartW);
  const toY = (v: number) => PAD + chartH - (v / (maxTokens || 1)) * chartH;

  const mainPoints = dailyTotals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const trendPoints = trendLine.map((v, i) => `${toX(i)},${toY(Math.max(0, v))}`).join(" ");

  // Y-axis labels
  const yStep = maxTokens / 3;
  const yLabels = [0, 1, 2, 3].map((i) => ({ v: i * yStep, y: toY(i * yStep) }));

  // X-axis labels: first, middle, last
  const xLabels: { label: string; x: number }[] = [];
  if (data.length > 0) {
    xLabels.push({ label: data[0].date.slice(5), x: toX(0) });
    if (data.length > 2) {
      const mid = Math.floor(data.length / 2);
      xLabels.push({ label: data[mid].date.slice(5), x: toX(mid) });
    }
    if (data.length > 1) {
      xLabels.push({ label: data[data.length - 1].date.slice(5), x: toX(data.length - 1) });
    }
  }

  if (data.length === 0) {
    return (
      <div className="orch-card" style={{ display: "flex", flexDirection: "column" }}>
        <div className="orch-section-header">Token Consumption</div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px", minHeight: "80px" }}>
          No token data yet
        </div>
      </div>
    );
  }

  return (
    <div className="orch-card" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div className="orch-section-header" style={{ marginBottom: 0 }}>Token Consumption</div>

      {/* Header stats */}
      <div style={{ display: "flex", gap: "12px", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
          Daily: <strong style={{ color: "var(--text-primary)" }}>{formatTokens(latest)}</strong>
        </span>
        <span style={{ fontSize: "11px", color: trendPositive ? "var(--accent-green)" : "var(--accent-red)" }}>
          Trend: {trendPositive ? "+" : ""}{trendPct}%
        </span>
      </div>

      {/* SVG chart */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ overflow: "visible" }}>
        {/* Y gridlines */}
        {yLabels.map(({ v, y }) => (
          <g key={v}>
            <line x1={PAD} y1={y} x2={PAD + chartW} y2={y} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD - 3} y={y + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)">
              {formatTokens(v)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map(({ label, x }) => (
          <text key={label} x={x} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
            {label}
          </text>
        ))}

        {/* Trend line (dashed, yellow) */}
        {dailyTotals.length > 1 && (
          <polyline
            points={trendPoints}
            fill="none"
            stroke="var(--accent-yellow)"
            strokeWidth="1.5"
            strokeDasharray="4,3"
            opacity="0.8"
          />
        )}

        {/* Main line (cyan) */}
        {dailyTotals.length > 1 && (
          <polyline
            points={mainPoints}
            fill="none"
            stroke="var(--accent-cyan)"
            strokeWidth="2"
            style={{ filter: "drop-shadow(0 1px 3px var(--accent-cyan))" }}
          />
        )}

        {/* Dot for single data point */}
        {dailyTotals.length === 1 && (
          <circle cx={toX(0)} cy={toY(dailyTotals[0])} r="4" fill="var(--accent-cyan)" />
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", fontSize: "10px", color: "var(--text-muted)" }}>
        <span>
          <span style={{ color: "var(--accent-cyan)", marginRight: "4px" }}>—</span>
          Daily Tokens
        </span>
        <span>
          <span style={{ color: "var(--accent-yellow)", marginRight: "4px" }}>- -</span>
          Trend
        </span>
      </div>
    </div>
  );
}
