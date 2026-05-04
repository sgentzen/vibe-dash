import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../../store";
import { useApi } from "../../hooks/useApi";
import type { ExecutiveSummary } from "../../../shared/types.js";
import { HealthScoreGauge } from "./HealthScoreGauge";
import { ActiveBlockersPanel } from "./ActiveBlockersPanel";
import { TopAtRiskMilestonesTile } from "./TopAtRiskMilestonesTile";
import { AgentComputeHeatmap } from "./AgentComputeHeatmap";
import { TokenConsumptionChart } from "./TokenConsumptionChart";
import "./orchestration.css";

export function OrchestrationView() {
  const { projects, tasks, milestones, blockers, selectedProjectId } = useAppState();

  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null;

  const projectTasks = useMemo(
    () => (activeProjectId ? tasks.filter((t) => t.project_id === activeProjectId) : tasks),
    [tasks, activeProjectId],
  );

  const activeBlockers = useMemo(
    () => blockers.filter(
      (b) => b.resolved_at === null && projectTasks.some((t) => t.id === b.task_id),
    ),
    [blockers, projectTasks],
  );

  const projectMilestones = useMemo(
    () => (activeProjectId ? milestones.filter((m) => m.project_id === activeProjectId) : milestones),
    [milestones, activeProjectId],
  );

  const openMilestoneCount = useMemo(
    () => projectMilestones.filter((m) => m.status === "open").length,
    [projectMilestones],
  );

  const done = useMemo(() => projectTasks.filter((t) => t.status === "done").length, [projectTasks]);

  const api = useApi();
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  // Refetch when project changes OR when WS-driven task/milestone state shifts,
  // so the server-authoritative milestone_health stays in sync with the rest of the view.
  const projectTaskCount = projectTasks.length;
  const projectDoneCount = done;
  const projectMilestoneCount = projectMilestones.length;
  useEffect(() => {
    if (!activeProjectId) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    api.getExecutiveSummary(activeProjectId)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [api, activeProjectId, projectTaskCount, projectDoneCount, projectMilestoneCount]);

  return (
    <div className="orch-wrapper">
      <div className="orch-subheader">
        <h1 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>Orchestration</h1>
        <span className="orch-subheader-title">AI Agent Orchestration Overview</span>
        <span className="orch-status-pill">AI Engine: Online</span>
      </div>

      <div className="orch-grid">
        {/* Center column */}
        <div className="orch-center-col">
          <HealthScoreGauge
            done={done}
            total={projectTasks.length}
            unresolvedBlockers={activeBlockers.length}
          />
          <ActiveBlockersPanel blockers={activeBlockers} tasks={projectTasks} />
        </div>

        {/* Right column */}
        <div className="orch-right-col">
          <TopAtRiskMilestonesTile
            health={summary?.milestone_health ?? []}
            openCount={openMilestoneCount}
          />
          <div className="orch-right-bottom">
            <AgentComputeHeatmap activeProjectId={activeProjectId} />
            <TokenConsumptionChart activeProjectId={activeProjectId} />
          </div>
        </div>
      </div>
    </div>
  );
}
