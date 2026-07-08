import type { CSSProperties, ReactNode } from "react";
import { typeScale } from "../styles/shared.js";

const edgeToggleStyle: CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text-secondary)",
  padding: "4px 10px",
  ...typeScale.caption,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export interface RailDrawersProps {
  /** Which drawer (if any) is currently open. Off-canvas only below 1024px. */
  drawer: null | "left" | "right";
  onOpenLeft: () => void;
  onOpenRight: () => void;
  onClose: () => void;
  /** Left rail content (e.g. ProjectList) — normal grid cell at wide widths. */
  left: ReactNode;
  /** Right rail content (e.g. collapsed aside or AgentFeed). */
  right: ReactNode;
  /** Content between the two edge toggles in the center column's top row (e.g. ProjectContextChip). */
  topRow: ReactNode;
  /** Center column body content, rendered below the top row. */
  children: ReactNode;
}

/**
 * Presentational wrapper for the three-column main-content layout.
 *
 * At >=1024px the rails render as normal grid cells (drawer state is inert —
 * CSS keeps `.rail-toggle` hidden and rails un-transformed). Below 1024px the
 * rails leave grid flow and become off-canvas overlay drawers, toggled via
 * edge buttons rendered in the center column's top row, with a backdrop that
 * closes on click.
 */
export function RailDrawers({
  drawer,
  onOpenLeft,
  onOpenRight,
  onClose,
  left,
  right,
  topRow,
  children,
}: RailDrawersProps) {
  return (
    <>
      <div className={`rail-drawer rail-left${drawer === "left" ? " rail-open" : ""}`}>
        {left}
      </div>

      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        {/* edge toggles — only rendered/visible under 1024px via .rail-toggle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            gap: "8px",
            minHeight: "32px",
          }}
        >
          <button
            className="rail-toggle"
            aria-label="Open projects"
            aria-expanded={drawer === "left"}
            onClick={onOpenLeft}
            style={edgeToggleStyle}
          >
            ☰ Projects
          </button>
          {topRow}
          <button
            className="rail-toggle"
            aria-label="Open agent feed"
            aria-expanded={drawer === "right"}
            onClick={onOpenRight}
            style={edgeToggleStyle}
          >
            Agents
          </button>
        </div>
        {children}
      </div>

      <div className={`rail-drawer rail-right${drawer === "right" ? " rail-open" : ""}`}>
        {right}
      </div>

      {drawer && <div className="drawer-backdrop" onClick={onClose} />}
    </>
  );
}
