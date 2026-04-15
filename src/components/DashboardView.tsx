import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader } from "../styles/shared.js";
import type { SprintDailyStats, VelocityData, ActivityHeatmapEntry, AgentContribution, AgentComparison } from "../types";
import { KpiCard, formatTokens } from "./dashboard/KpiCard";
import { BurndownCard, VelocityCard, ContributionsCard, HeatmapCard } from "./dashboard/ChartCards";
import { CostTimeseriesCard, CostByModelCard, CostByAgentCard } from "./dashboard/CostCards";
import { AgentEfficiencyCard } from "./dashboard/AgentEfficiencyCard";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

export function DashboardView() {
  const { projects, sprints, blockers, tasks, selectedProjectId, pollGeneration } = useAppState();
  const api = useApi();

  const [burndown, setBurndown] = useState<SprintDailyStats[]>([]);
  const [velocity, setVelocity] = useState<VelocityData[]>([]);
  const [heatmap, setHeatmap] = useState<ActivityHeatmapEntry[]>([]);
  const [contributions, setContributions] = useState<AgentContribution[]>([]);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"day" | "week" | "sprint">("week");
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [agentComparison, setAgentComparison] = useState<AgentComparison | null>(null);

  // Project-scoped data
  const projectId = selectedProjectId || projects[0]?.id;
  const projectSprints = sprints.filter((s) => !projectId || s.project_id === projectId);
  const projectTasks = tasks.filter((t) => !projectId || t.project_id === projectId);
  const projectTaskIds = new Set(projectTasks.map((t) => t.id));
  const projectBlockers = blockers.filter((b) => !projectId || projectTaskIds.has(b.task_id));

  const activeSprint = projectSprints.find((s) => s.status === "active");
  const overdueTasks = projectTasks.filter(
    (t) => t.due_date && t.status !== "done" && new Date(t.due_date) < new Date()
  );
  const unresolvedBlockers = projectBlockers.filter((b) => !b.resolved_at);
  const doneTaskCount = projectTasks.filter((t) => t.status === "done").length;

  // Track task status changes for the active sprint to trigger dashboard refreshes
  const sprintTaskStatusKey = activeSprint
    ? projectTasks.filter((t) => t.sprint_id === activeSprint.id).map((t) => `${t.id}:${t.status}`).join(",")
    : "";

  // Dashboard charts: refresh on sprint task status changes + polling
  useEffect(() => {
    async function load() {
      try {
        const [vel, heat] = await Promise.all([
          api.getVelocityTrend(5, projectId),
          api.getActivityHeatmap(projectId),
        ]);
        setVelocity(vel);
        setHeatmap(heat);

        if (activeSprint) {
          const [bd, contrib] = await Promise.all([
            api.getSprintBurndown(activeSprint.id),
            api.getSprintContributions(activeSprint.id),
          ]);
          setBurndown(bd);
          setContributions(contrib);
        }
      } catch (e) {
        console.warn("[DashboardView] failed to load chart data", e);
      }
    }
    load();
  }, [api, activeSprint?.id, projectId, sprintTaskStatusKey, pollGeneration]);

  // Cost data: refresh on project change or sprint task status changes (not every poll tick)
  useEffect(() => {
    if (!projectId) return;
    async function loadCosts() {
      try {
        const [summary, ts, byModel, byAgent] = await Promise.all([
          api.getProjectCostSummary(projectId!),
          api.getCostTimeseries({ project_id: projectId!, days: "30" }),
          api.getCostByModel({ project_id: projectId! }),
          api.getCostByAgent({ project_id: projectId! }),
        ]);
        setCostSummary(summary);
        setCostTimeseries(ts);
        setCostByModel(byModel);
        setCostByAgent(byAgent);
      } catch (e) {
        console.warn("[DashboardView] failed to load cost data", e);
      }
    }
    loadCosts();
  }, [api, projectId, sprintTaskStatusKey, pollGeneration]);

  // Load agent performance comparison
  useEffect(() => {
    api.getAgentComparison().then(setAgentComparison).catch(() => {});
  }, [api, pollGeneration]);

  async function handleGenerateReport() {
    if (!projectId) return;
    try {
      const report = await api.generateReport(projectId, reportPeriod);
      setReportText(report);
    } catch {
      setReportText("Failed to generate report.");
    }
  }

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "16px", fontWeight: 600 }}>
        Dashboard
      </h2>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
        <KpiCard label="Active Sprint" value={activeSprint?.name ?? "None"} color="var(--accent-blue)" />
        <KpiCard label="Overdue Tasks" value={String(overdueTasks.length)} color={overdueTasks.length > 0 ? "var(--accent-red)" : "var(--accent-green)"} />
        <KpiCard label="Active Blockers" value={String(unresolvedBlockers.length)} color={unresolvedBlockers.length > 0 ? "var(--accent-yellow)" : "var(--accent-green)"} />
        <KpiCard label="Active Tasks" value={String(projectTasks.filter((t) => t.status !== "done").length)} color="var(--text-secondary)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <BurndownCard burndown={burndown} activeSprint={activeSprint} />
        <VelocityCard velocity={velocity} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <ContributionsCard contributions={contributions} activeSprint={activeSprint} />
        <HeatmapCard heatmap={heatmap} />
      </div>

      {/* Blockers + Overdue */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <div style={cardStyle}>
          <div style={headerStyle}>Active Blockers ({unresolvedBlockers.length})</div>
          {unresolvedBlockers.length === 0 ? (
            <div style={{ color: "var(--accent-green)", fontSize: "12px" }}>No active blockers</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {unresolvedBlockers.slice(0, 10).map((b) => (
                <div key={b.id} style={{ fontSize: "12px", color: "var(--accent-yellow)" }}>
                  {b.reason}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={headerStyle}>Overdue Tasks ({overdueTasks.length})</div>
          {overdueTasks.length === 0 ? (
            <div style={{ color: "var(--accent-green)", fontSize: "12px" }}>No overdue tasks</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {overdueTasks.slice(0, 10).map((t) => (
                <div key={t.id} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-primary)" }}>{t.title}</span>
                  <span style={{ color: "var(--accent-red)", fontSize: "10px" }}>{t.due_date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cost & Token Tracking */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
        <KpiCard label="Total Spend" value={costSummary ? `$${costSummary.total_cost_usd.toFixed(2)}` : "$0.00"} color="var(--accent-blue)" />
        <KpiCard label="Input Tokens" value={costSummary ? formatTokens(costSummary.total_input_tokens) : "0"} color="var(--text-secondary)" />
        <KpiCard label="Output Tokens" value={costSummary ? formatTokens(costSummary.total_output_tokens) : "0"} color="var(--text-secondary)" />
        <KpiCard
          label="Avg Cost/Task"
          value={costSummary && doneTaskCount > 0
            ? `$${(costSummary.total_cost_usd / doneTaskCount).toFixed(3)}`
            : "$0.00"}
          color="var(--accent-green)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <CostTimeseriesCard data={costTimeseries} />
        <CostByModelCard data={costByModel} />
      </div>

      <CostByAgentCard data={costByAgent} />

      {agentComparison && <AgentEfficiencyCard agentComparison={agentComparison} />}

      {/* Report Generation */}
      <div style={cardStyle}>
        <div style={headerStyle}>Generate Status Report</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
          <select
            value={reportPeriod}
            onChange={(e) => setReportPeriod(e.target.value as "day" | "week" | "sprint")}
            style={{
              background: "var(--bg-tertiary)", border: "1px solid var(--border)",
              borderRadius: "4px", color: "var(--text-primary)", padding: "4px 8px", fontSize: "12px",
            }}
          >
            <option value="day">Last 24 hours</option>
            <option value="week">Last 7 days</option>
            <option value="sprint">Current sprint</option>
          </select>
          <button
            onClick={handleGenerateReport}
            style={{
              background: "transparent", border: "1px solid var(--accent-blue)",
              color: "var(--accent-blue)", borderRadius: "6px", padding: "4px 12px",
              fontSize: "12px", cursor: "pointer",
            }}
          >
            Generate Report
          </button>
          {reportText && (
            <button
              onClick={() => { navigator.clipboard.writeText(reportText); }}
              style={{
                background: "transparent", border: "1px solid var(--accent-green)",
                color: "var(--accent-green)", borderRadius: "6px", padding: "4px 12px",
                fontSize: "12px", cursor: "pointer",
              }}
            >
              Copy to Clipboard
            </button>
          )}
        </div>
        {reportText && (
          <pre style={{
            background: "var(--bg-tertiary)", border: "1px solid var(--border)",
            borderRadius: "6px", padding: "12px", fontSize: "11px",
            color: "var(--text-secondary)", whiteSpace: "pre-wrap",
            maxHeight: "300px", overflowY: "auto",
          }}>
            {reportText}
          </pre>
        )}
      </div>
    </div>
  );
}
