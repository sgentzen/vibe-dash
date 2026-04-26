import type { ActiveView } from "../../state/types";
import { viewBtnStyle } from "./styles";

const VIEWS: { key: ActiveView; label: string }[] = [
  { key: "orchestration", label: "Overview" },
  { key: "board", label: "Board" },
  { key: "agents", label: "Agents" },
  { key: "list", label: "List" },
  { key: "dashboard", label: "Dash" },
  { key: "timeline", label: "Timeline" },
  { key: "activity", label: "Activity" },
  { key: "worktrees", label: "Worktrees" },
  { key: "executive", label: "Executive" },
];

interface ViewToggleProps {
  activeView: ActiveView;
  onChange: (view: ActiveView) => void;
}

export function ViewToggle({ activeView, onChange }: ViewToggleProps) {
  return (
    <div style={{ display: "flex", gap: "2px", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "2px" }}>
      {VIEWS.map((v) => (
        <button
          key={v.key}
          onClick={() => onChange(v.key)}
          style={{
            ...viewBtnStyle,
            background: activeView === v.key ? "var(--bg-primary)" : "transparent",
            color: activeView === v.key ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
