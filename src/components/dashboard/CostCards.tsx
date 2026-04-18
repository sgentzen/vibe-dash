import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import { formatTokens } from "./KpiCard";

interface CostTimeseriesEntry {
  date: string;
  total_cost_usd: number;
}

interface CostByModelEntry {
  model: string;
  provider: string;
  total_cost_usd: number;
  total_tokens: number;
}

interface CostByAgentEntry {
  agent_id: string;
  agent_name: string;
  total_cost_usd: number;
  total_tokens: number;
}

export const CostTimeseriesCard = memo(function CostTimeseriesCard({ data }: { data: CostTimeseriesEntry[] }) {
  return (
    <CardWrapper title="Daily Spend (Last 30 Days)">
      {data.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No cost data yet. Agents will log costs as they work.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "120px" }}>
          {(() => { const maxCost = Math.max(...data.map((x) => x.total_cost_usd), 0.01); return data.map((d) => {
            const pct = (d.total_cost_usd / maxCost) * 100;
            return (
              <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  width: "100%", background: "var(--accent-blue)", borderRadius: "2px",
                  height: `${pct}%`, minHeight: "2px",
                }} title={`${d.date}: $${d.total_cost_usd.toFixed(4)}`} />
                <span style={{ fontSize: "8px", color: "var(--text-muted)", marginTop: "2px" }}>
                  {d.date.slice(8)}
                </span>
              </div>
            );
          }); })()}
        </div>
      )}
    </CardWrapper>
  );
});

export const CostByModelCard = memo(function CostByModelCard({ data }: { data: CostByModelEntry[] }) {
  return (
    <CardWrapper title="Cost by Model">
      {data.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No model cost data yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(() => { const maxCost = Math.max(...data.map((x) => x.total_cost_usd), 0.01); return data.map((m) => {
            const pct = (m.total_cost_usd / maxCost) * 100;
            return (
              <div key={`${m.model}-${m.provider}`}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                  <span style={{ color: "var(--text-primary)" }}>{m.model}</span>
                  <span style={{ color: "var(--text-muted)" }}>${m.total_cost_usd.toFixed(4)} ({formatTokens(m.total_tokens)} tok)</span>
                </div>
                <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-purple)", borderRadius: "2px" }} />
                </div>
              </div>
            );
          }); })()}
        </div>
      )}
    </CardWrapper>
  );
});

export const CostByAgentCard = memo(function CostByAgentCard({ data }: { data: CostByAgentEntry[] }) {
  if (data.length === 0) return null;
  return (
    <CardWrapper title="Cost by Agent" style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {(() => { const maxCost = Math.max(...data.map((x) => x.total_cost_usd), 0.01); return data.map((a) => {
          const pct = (a.total_cost_usd / maxCost) * 100;
          return (
            <div key={a.agent_id}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                <span style={{ color: "var(--text-primary)" }}>{a.agent_name}</span>
                <span style={{ color: "var(--text-muted)" }}>${a.total_cost_usd.toFixed(4)} ({formatTokens(a.total_tokens)} tok)</span>
              </div>
              <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-green)", borderRadius: "2px" }} />
              </div>
            </div>
          );
        }); })()}
      </div>
    </CardWrapper>
  );
});
