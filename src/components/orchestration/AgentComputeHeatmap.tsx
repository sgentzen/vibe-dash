import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../hooks/useApi";
import { usePollingState } from "../../store";
import type { ActivityHeatmapEntry } from "../../types";

interface Props {
  activeProjectId: string | null;
}

const CELL = 22;
const GAP = 4;
const MAX_AGENTS = 8;
const MAX_HOURS = 12;
const LEGEND_STEPS = 5;

export function AgentComputeHeatmap({ activeProjectId }: Props) {
  const api = useApi();
  const { pollGeneration } = usePollingState();
  const [data, setData] = useState<ActivityHeatmapEntry[]>([]);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    api
      .getActivityHeatmap(activeProjectId ?? undefined)
      .then(setData)
      .catch(() => {});
  }, [api, activeProjectId, pollGeneration]);

  const { agents, hours, matrix, maxCount } = useMemo(() => {
    if (data.length === 0) return { agents: [], hours: [], matrix: new Map(), maxCount: 0 };

    const agentTotals = new Map<string, number>();
    for (const e of data) {
      agentTotals.set(e.agent_name, (agentTotals.get(e.agent_name) ?? 0) + e.count);
    }

    const topAgents = [...agentTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_AGENTS)
      .map(([name]) => name);

    const allHours = [...new Set(data.map((e) => e.hour))].sort((a, b) => a - b);
    const latestHours = allHours.slice(-MAX_HOURS);

    const matrix = new Map<string, Map<number, number>>();
    for (const e of data) {
      if (!topAgents.includes(e.agent_name)) continue;
      if (!latestHours.includes(e.hour)) continue;
      const agentMap = matrix.get(e.agent_name) ?? new Map<number, number>();
      agentMap.set(e.hour, (agentMap.get(e.hour) ?? 0) + e.count);
      matrix.set(e.agent_name, agentMap);
    }

    let maxCount = 0;
    for (const agentMap of matrix.values()) {
      for (const c of agentMap.values()) {
        if (c > maxCount) maxCount = c;
      }
    }

    return { agents: topAgents, hours: latestHours, matrix, maxCount };
  }, [data]);

  const labelWidth = 80;
  const gridWidth = hours.length * (CELL + GAP);
  const gridHeight = agents.length * (CELL + GAP);

  if (data.length === 0) {
    return (
      <div className="orch-card" style={{ display: "flex", flexDirection: "column" }}>
        <div className="orch-section-header">Agent Compute Usage</div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px", minHeight: "80px" }}>
          No agent activity yet
        </div>
      </div>
    );
  }

  return (
    <div className="orch-card" style={{ position: "relative" }}>
      <div className="orch-section-header">Agent Compute Usage</div>

      <div style={{ overflowX: "auto" }}>
        <svg
          width={labelWidth + gridWidth}
          height={20 + gridHeight}
          style={{ display: "block", fontSize: "10px" }}
          aria-label={`Agent compute heatmap: ${agents.length} agents over ${hours.length} hours, max ${maxCount} events per cell`}
        >
          <title>{`Agent compute heatmap — ${agents.length} agents, ${hours.length} hour buckets, max ${maxCount} events`}</title>
          {/* Hour labels along top */}
          {hours.map((h, ci) => (
            <text
              key={h}
              x={labelWidth + ci * (CELL + GAP) + CELL / 2}
              y={12}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="9"
            >
              {h}
            </text>
          ))}

          {/* Rows */}
          {agents.map((agent, ri) => {
            const y = 20 + ri * (CELL + GAP);
            const agentMap = matrix.get(agent) ?? new Map<number, number>();

            return (
              <g key={agent}>
                {/* Agent label */}
                <text
                  x={labelWidth - 6}
                  y={y + CELL / 2 + 3}
                  textAnchor="end"
                  fill="var(--text-secondary)"
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                  fontWeight="500"
                >
                  <title>{agent}</title>
                  {agent.length > 10 ? agent.slice(0, 10) + "…" : agent}
                </text>

                {/* Cells */}
                {hours.map((h, ci) => {
                  const count = agentMap.get(h) ?? 0;
                  const opacity = maxCount > 0 ? Math.max(0.08, count / maxCount) : 0.08;
                  return (
                    <rect
                      key={h}
                      x={labelWidth + ci * (CELL + GAP)}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx="3"
                      style={{ fill: `rgba(var(--accent-cyan-rgb), ${opacity})`, cursor: count > 0 ? "pointer" : "default" }}
                      aria-label={`${agent} — hour ${h} — ${count} events`}
                      onMouseEnter={(e) => {
                        const rect = (e.target as SVGRectElement).getBoundingClientRect();
                        setTooltip({ text: `${agent} · ${h}:00 · ${count} events`, x: rect.left, y: rect.top });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", fontSize: "9px", color: "var(--text-muted)" }}>
        <span>0</span>
        <div
          style={{
            flex: 1,
            height: "8px",
            borderRadius: "4px",
            background: `linear-gradient(to right, ${
              Array.from({ length: LEGEND_STEPS }, (_, i) => {
                const opacity = 0.08 + (i / (LEGEND_STEPS - 1)) * 0.92;
                return `rgba(var(--accent-cyan-rgb), ${opacity.toFixed(2)})`;
              }).join(", ")
            })`,
          }}
          role="img"
          aria-label={`Color scale: 0 events (faint) to ${maxCount} events (solid)`}
        />
        <span>{maxCount}</span>
      </div>

      {tooltip && (
        <div style={{
          position: "fixed",
          left: tooltip.x,
          top: tooltip.y - 28,
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "3px 8px",
          fontSize: "11px",
          color: "var(--text-primary)",
          pointerEvents: "none",
          zIndex: 1000,
          whiteSpace: "nowrap",
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
