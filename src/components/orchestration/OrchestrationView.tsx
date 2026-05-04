import { useMemo } from "react";
import { useAppState } from "../../store";
import { typeScale } from "../../styles/shared.js";
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

  const done = useMemo(() => projectTasks.filter((t) => t.status === "done").length, [projectTasks]);

  return (
    <div className="orch-wrapper">
      <div className="orch-subheader">
        <h1 style={{ ...typeScale.body, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Orchestration</h1>
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
            milestones={projectMilestones}
            tasks={projectTasks}
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
