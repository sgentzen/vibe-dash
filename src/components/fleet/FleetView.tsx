import { useNavigationState, useAppDispatch } from "../../store";
import { DashboardView } from "../DashboardView";
import { ExecutiveView } from "../ExecutiveView";
import { AgentDashboard } from "../AgentDashboard";
import { WorktreeView } from "../WorktreeView";
import { TimelineView } from "../TimelineView";
import { PresetSwitcher } from "./PresetSwitcher";

export function FleetView() {
  const { fleetPreset } = useNavigationState();
  const dispatch = useAppDispatch();

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, flex: 1 }}>
      <PresetSwitcher
        active={fleetPreset}
        onChange={(p) => dispatch({ type: "SET_FLEET_PRESET", payload: p })}
      />
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {fleetPreset === "overview" ? (
          <>
            <DashboardView />
            <ExecutiveView />
          </>
        ) : fleetPreset === "agents" ? (
          <>
            <AgentDashboard />
            <WorktreeView />
          </>
        ) : (
          <TimelineView />
        )}
      </div>
    </div>
  );
}
