import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import { EmptyState } from "../EmptyState.js";
import { formatTokens } from "./KpiCard";
import { CountBadge } from "./CountBadge";

// Totals are typed nullable here on purpose. The API floors every aggregate
// with COALESCE, so a null should be impossible, but these cards render inside
// a tree with no ErrorBoundary: one `null.toFixed(4)` unmounts the entire
// dashboard, not just the card. A card that degrades to "n/a" is a far cheaper
// failure than a blank page, so the belt is worn with the braces.
type MaybeCost = number | null | undefined;

interface CostTimeseriesEntry {
  date: string;
  total_cost_usd: MaybeCost;
}

interface CostByModelEntry {
  model: string;
  provider: string;
  total_cost_usd: MaybeCost;
  total_tokens: number;
  /**
   * Entries with tokens recorded but no cost, because the model is not in the
   * price table. Nullable for the same reason the totals are: an older
   * server, or a shape this component did not expect, must degrade rather
   * than blank the page.
   */
  unpriced_entries?: number | null;
}

interface CostByAgentEntry {
  agent_id: string;
  agent_name: string;
  total_cost_usd: MaybeCost;
  total_tokens: number;
  /**
   * Rows suppressed as duplicates of an observed client's transcripts.
   *
   * Nullable for the same reason the totals are: an older server, or a shape
   * this component did not expect, must degrade rather than blank the page.
   */
  excluded_entries?: number | null;
  /** Same meaning as on `CostByModelEntry`, see there. */
  unpriced_entries?: number | null;
}

/** Wording shared by the unpriced badge and its tooltip, so the two cannot drift apart. */
function unpricedTitle(count: number): string {
  return (
    `${count} entries here have tokens recorded but no cost, because the model ` +
    `is not in the price table. Nothing went wrong: this figure is a floor, not the whole amount.`
  );
}

/** Wording shared by the badge and its tooltip, so the two cannot drift apart. */
function excludedTitle(count: number): string {
  return (
    `${count} self-reported ${count === 1 ? "entry" : "entries"} excluded as duplicates, ` +
    `because this agent's client is marked as observed through its transcripts. ` +
    `That spend is counted from the transcripts instead, so it is not missing from the totals above.`
  );
}

/** A cost as a number for arithmetic (bar heights), treating unknown as 0. */
function costValue(value: MaybeCost): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A cost for display. "n/a" rather than "$0.0000", which would read as free. */
function formatUsd(value: MaybeCost): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "n/a";
}

export const CostTimeseriesCard = memo(function CostTimeseriesCard({ data }: { data: CostTimeseriesEntry[] }) {
  return (
    <CardWrapper title="Daily Spend (Last 30 Days)">
      {data.length === 0 ? (
        <EmptyState message="No cost data yet. Agents will log costs as they work." />
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "120px" }}>
          {(() => { const maxCost = Math.max(...data.map((x) => costValue(x.total_cost_usd)), 0.01); return data.map((d) => {
            const pct = (costValue(d.total_cost_usd) / maxCost) * 100;
            return (
              <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  width: "100%", background: "var(--accent-blue)", borderRadius: "2px",
                  height: `${pct}%`, minHeight: "2px",
                }} title={`${d.date}: ${formatUsd(d.total_cost_usd)}`} />
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
        <EmptyState message="No model cost data yet." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {(() => { const maxCost = Math.max(...data.map((x) => costValue(x.total_cost_usd)), 0.01); return data.map((m) => {
            const pct = (costValue(m.total_cost_usd) / maxCost) * 100;
            return (
              <div key={`${m.model}-${m.provider}`}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                  <span style={{ color: "var(--text-primary)" }}>{m.model}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {formatUsd(m.total_cost_usd)}
                    <CountBadge
                      count={m.unpriced_entries}
                      label="unpriced"
                      explanation={unpricedTitle(m.unpriced_entries ?? 0)}
                    />
                    {" "}({formatTokens(m.total_tokens)} tok)
                  </span>
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
    <CardWrapper title="Cost by Agent" style={{ marginBottom: "var(--space-4)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {(() => { const maxCost = Math.max(...data.map((x) => costValue(x.total_cost_usd)), 0.01); return data.map((a) => {
          const pct = (costValue(a.total_cost_usd) / maxCost) * 100;
          return (
            <div key={a.agent_id}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                <span style={{ color: "var(--text-primary)" }}>{a.agent_name}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {formatUsd(a.total_cost_usd)}
                  <CountBadge
                    count={a.excluded_entries}
                    label="excluded"
                    explanation={excludedTitle(a.excluded_entries ?? 0)}
                  />
                  <CountBadge
                    count={a.unpriced_entries}
                    label="unpriced"
                    explanation={unpricedTitle(a.unpriced_entries ?? 0)}
                  />
                  {" "}({formatTokens(a.total_tokens)} tok)
                </span>
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
