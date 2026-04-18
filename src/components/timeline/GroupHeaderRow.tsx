import { GROUP_HEADER_HEIGHT } from "./constants";
import type { TaskGroup } from "./utils";

interface GroupHeaderRowProps {
  group: TaskGroup;
  collapsed: boolean;
  onToggle: () => void;
  labelWidth: number;
  timelineWidth: number;
}

export function GroupHeaderRow({
  group,
  collapsed,
  onToggle,
  labelWidth,
  timelineWidth,
}: GroupHeaderRowProps) {
  const pct = group.totalCount > 0 ? Math.round((group.completedCount / group.totalCount) * 100) : 0;

  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        height: GROUP_HEADER_HEIGHT,
        cursor: "pointer",
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid var(--border)",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div
        style={{
          width: labelWidth,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "0 8px",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted)",
            transition: "transform 0.15s",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}
        >
          ▼
        </span>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {group.label}
        </span>
        {group.sublabel && (
          <span style={{ fontSize: "11px", color: "var(--text-muted)", flexShrink: 0 }}>
            {group.sublabel}
          </span>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingLeft: "8px",
          width: timelineWidth,
        }}
      >
        {/* Completion bar */}
        <div
          style={{
            width: "80px",
            height: "6px",
            borderRadius: "3px",
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: "3px",
              background: pct === 100 ? "var(--accent-green)" : "var(--accent-purple)",
              transition: "width 0.3s",
            }}
          />
        </div>
        <span style={{ fontSize: "11px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          {group.completedCount}/{group.totalCount} ({pct}%)
        </span>
      </div>
    </div>
  );
}
