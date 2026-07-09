import type { ActiveView } from "../../state/types";
import { viewBtnStyle } from "./styles";

const VIEWS: { key: ActiveView; label: string }[] = [
  { key: "fleet", label: "Fleet" },
  { key: "board", label: "Board" },
  { key: "feed", label: "Feed" },
];

interface ViewToggleProps {
  activeView: ActiveView;
  onChange: (view: ActiveView) => void;
}

export function ViewToggle({ activeView, onChange }: Readonly<ViewToggleProps>) {
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
