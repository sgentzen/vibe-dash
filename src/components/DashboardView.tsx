import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader } from "../styles/shared.js";
import type { MilestoneDailyStats, ActivityHeatmapEntry, AgentContribution, AgentComparison } from "../types";
import { KpiCard, formatTokens } from "./dashboard/KpiCard";
import { MilestoneProgressCard, MilestoneOverviewCard, ContributionsCard, HeatmapCard } from "./dashboard/ChartCards";
import { CostTimeseriesCard, CostByModelCard, CostByAgentCard } from "./dashboard/CostCards";
import { AgentEfficiencyCard } from "./dashboard/AgentEfficiencyCard";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

export function DashboardView() {
  const { projects, milestones, blockers, tasks, selectedProjectId, pollGeneration } = useAppState();
  const api = useApi();

  const [dailyStats, setDailyStats] = useState<MilestoneDailyStats[]>([]);
  const [heatmap, setHeatmap] = useState<ActivityHeatmapEntry[]>([]);
  const [contributions, setContributions] = useState<AgentContribution[]>([]);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"day" | "week" | "milestone">("week");
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [agentComparison, setAgentComparison] = useState<AgentComparison | null>(null);

  // Project-scoped data
  const projectId = selectedProjectId || projects[0]?.id;
  const projectMilestones = milestones.filter((m) => !projectId || m.project_id === projectId);
  const projectTasks = tasks.filter((t) => !projectId || t.project_id === projectId);
  const projectTaskIds = new Set(projectTasks.map((t) => t.id));
  const projectBlockers = blockers.filter((b) => !projectId || projectTaskIds.has(b.task_id));

  const openMilestones = projectMilestones.filter((m) => m.status === "open");
  const overdueTasks = projectTasks.filter(
    (t) => t.due_date && t.status !== "done" && new Date(t.due_date) < new Date()
  );
  const unresolvedBlockers = projectBlockers.filter((b) => !b.resolved_at);
  const doneTaskCount = projectTasks.filter((t) => t.status === "done").length;

  // Track task status changes for open milestones to trigger dashboard refreshes
  const milestoneTaskStatusKey = openMilestones.length > 0
    ? openMilestones.map((m) => projectTasks.filter((t) => t.milestone_id === m.id).map((t) => `${t.id}:${t.status}`).join(";")).join("|")
    : "";

  // Dashboard charts: refresh on milestone task status changes + polling
  useEffect(() => {
    async function load() {
      try {
        const [heat] = await Promise.all([
          api.getActivityHeatmap(projectId),
        ]);
        setHeatmap(heat);

        if (openMilestones.length > 0) {
          const firstOpenMilestone = openMilestones[0];
          const [stats, contrib] = await Promise.all([
            api.getMilestoneDailyStats(firstOpenMilestone.id),
            api.getMilestoneContributions(firstOpenMilestone.id),
          ]);
          setDailyStats(stats);
          setContributions(contrib);
        }
      } catch (e) {
        console.warn("[DashboardView] failed to load chart data", e);
      }
    }
    load();
  }, [api, openMilestones.length > 0 ? openMilestones[0]?.id : null, projectId, milestoneTaskStatusKey, pollGeneration]);

  // Cost data: refresh on project change or milestone task status changes (not every poll tick)
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
  }, [api, projectId, milestoneTaskStatusKey, pollGeneration]);

  // Load agent performance comparison
  useEffect(() => {
    api.getAgentComparison().then(setAgentComparison).catch(() => {});
  }, [api, pollGeneration]);

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
        <KpiCard label="Open Milestones" value={String(openMilestones.length)} color="var(--accent-blue)" />
        <KpiCard label="Overdue Tasks" value={String(overdueTasks.length)} color={overdueTasks.length > 0 ? "var(--accent-red)" : "var(--accent-green)"} />
        <KpiCard label="Active Blockers" value={String(unresolvedBlockers.length)} color={unresolvedBlockers.length > 0 ? "var(--accent-yellow)" : "var(--accent-green)"} />
        <KpiCard label="Active Tasks" value={String(projectTasks.filter((t) => t.status !== "done").length)} color="var(--text-secondary)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <MilestoneProgressCard dailyStats={dailyStats} openMilestones={openMilestones} />
        <MilestoneOverviewCard openMilestones={openMilestones} projectTasks={projectTasks} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <ContributionsCard contributions={contributions} openMilestones={openMilestones} />
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
            onChange={(e) => setReportPeriod(e.target.value as "day" | "week" | "milestone")}
            style={{
              background: "var(--bg-tertiary)", border: "1px solid var(--border)",
              borderRadius: "4px", color: "var(--text-primary)", padding: "4px 8px", fontSize: "12px",
            }}
          >
            <option value="day">Last 24 hours</option>
            <option value="week">Last 7 days</option>
            <option value="milestone">Current milestone</option>
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
