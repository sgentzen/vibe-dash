import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader } from "../styles/shared.js";
import type { MilestoneDailyStats, ActivityHeatmapEntry, AgentContribution, AgentComparison } from "../types";
import { KpiCard, formatTokens } from "./dashboard/KpiCard";
import { CostTimeseriesCard, CostByModelCard, CostByAgentCard } from "./dashboard/CostCards";
import { AgentEfficiencyCard } from "./dashboard/AgentEfficiencyCard";
import { MilestoneProgressCard, MilestoneOverviewCard } from "./dashboard/MilestoneCards";
import { AgentContributionsCard, ActivityHeatmapCard } from "./dashboard/ActivityCards";
import { ReportGeneratorCard } from "./dashboard/ReportGeneratorCard";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

export function DashboardView() {
  const { projects, milestones, blockers, tasks, selectedProjectId, pollGeneration } = useAppState();
  const api = useApi();

  const [dailyStats, setDailyStats] = useState<MilestoneDailyStats[]>([]);
  const [heatmap, setHeatmap] = useState<ActivityHeatmapEntry[]>([]);
  const [contributions, setContributions] = useState<AgentContribution[]>([]);
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [agentComparison, setAgentComparison] = useState<AgentComparison | null>(null);

  // Project-scoped data — null means "all projects"
  const projectId = selectedProjectId ?? null;
  const projectMilestones = projectId ? milestones.filter((m) => m.project_id === projectId) : milestones;
  const projectTasks = projectId ? tasks.filter((t) => t.project_id === projectId) : tasks;
  const projectTaskIds = new Set(projectTasks.map((t) => t.id));
  const projectBlockers = projectId ? blockers.filter((b) => projectTaskIds.has(b.task_id)) : blockers;

  const openMilestones = projectMilestones.filter((m) => m.status === "open");
  const overdueTasks = projectTasks.filter(
    (t) => t.due_date && t.status !== "done" && new Date(t.due_date) < new Date()
  );
  const unresolvedBlockers = projectBlockers.filter((b) => !b.resolved_at);
  const doneTaskCount = projectTasks.filter((t) => t.status === "done").length;

  const milestoneTaskStatusKey = openMilestones.length > 0
    ? openMilestones.map((m) => projectTasks.filter((t) => t.milestone_id === m.id).map((t) => `${t.id}:${t.status}`).join(";")).join("|")
    : "";

  useEffect(() => {
    async function load() {
      try {
        const heat = await api.getActivityHeatmap(projectId ?? undefined);
        setHeatmap(heat);

        if (openMilestones.length > 0) {
          const firstOpenMilestone = openMilestones[0];
          const [stats, contrib] = await Promise.all([
            api.getMilestoneDailyStats(firstOpenMilestone.id),
            api.getMilestoneContributions(firstOpenMilestone.id),
          ]);
          setDailyStats(stats);
          setContributions(contrib);
        } else {
          setDailyStats([]);
          setContributions([]);
        }
      } catch (e) {
        console.warn("[DashboardView] failed to load chart data", e);
      }
    }
    load();
  }, [api, openMilestones.length > 0 ? openMilestones[0]?.id : null, projectId, milestoneTaskStatusKey, pollGeneration]);

  // Cost data: refresh on project change or milestone task status changes
  useEffect(() => {
    async function loadCosts() {
      try {
        const [summary, ts, byModel, byAgent] = await Promise.all([
          api.getCostSummary(projectId ?? undefined),
          api.getCostTimeseries({ project_id: projectId ?? undefined, days: "30" }),
          api.getCostByModel({ project_id: projectId ?? undefined }),
          api.getCostByAgent({ project_id: projectId ?? undefined }),
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

  useEffect(() => {
    api.getAgentComparison().then(setAgentComparison).catch(() => {});
  }, [api, pollGeneration]);

  async function handleGenerateReport() {
    const reportProjectId = projectId ?? projects[0]?.id;
    if (!reportProjectId) return;
    try {
      const report = await api.generateReport(reportProjectId, reportPeriod);
      setReportText(report);
    } catch {
      setReportText("Failed to generate report.");
    }
  }

  const reportProjectId = projectId ?? projects[0]?.id ?? null;

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "16px", fontWeight: 600 }}>
        Dashboard
      </h2>

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
        <AgentContributionsCard contributions={contributions} openMilestones={openMilestones} />
        <ActivityHeatmapCard heatmap={heatmap} />
      </div>

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

      {/* Cost & Token Tracking — only show details when cost data exists */}
      {costSummary && costSummary.entry_count > 0 ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
            <KpiCard label="Total Spend" value={`$${costSummary.total_cost_usd.toFixed(2)}`} color="var(--accent-blue)" />
            <KpiCard label="Input Tokens" value={formatTokens(costSummary.total_input_tokens)} color="var(--text-secondary)" />
            <KpiCard label="Output Tokens" value={formatTokens(costSummary.total_output_tokens)} color="var(--text-secondary)" />
            <KpiCard
              label="Avg Cost/Task"
              value={doneTaskCount > 0 ? `$${(costSummary.total_cost_usd / doneTaskCount).toFixed(3)}` : "$0.00"}
              color="var(--accent-green)"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <CostTimeseriesCard data={costTimeseries} />
            <CostByModelCard data={costByModel} />
          </div>

          <CostByAgentCard data={costByAgent} />
        </>
      ) : (
        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <div style={headerStyle}>Cost & Token Tracking</div>
          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            No cost data recorded yet. Agents report costs via the <code style={{ color: "var(--accent-blue)" }}>log_cost</code> MCP tool after completing work. Cost cards will appear here once data is available.
          </div>
        </div>
      )}

      {agentComparison && <AgentEfficiencyCard agentComparison={agentComparison} />}

      <ReportGeneratorCard projectId={reportProjectId} />
    </div>
  );
}
