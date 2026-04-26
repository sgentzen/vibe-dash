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
        background: "color-mix(in srgb, var(--accent-purple) 6%, var(--bg-primary))",
        borderTop: "1px solid color-mix(in srgb, var(--accent-purple) 20%, var(--border))",
        borderBottom: "1px solid color-mix(in srgb, var(--accent-purple) 20%, var(--border))",
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
            color: "var(--accent-purple)",
            transition: "transform 0.15s",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}
        >
          ▼
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "13px",
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
            background: "var(--bg-tertiary)",
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
