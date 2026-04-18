import type { CSSProperties, ReactNode } from "react";

interface ModalDrawerProps {
  children: ReactNode;
  ariaLabel: string;
  width?: string;
  zIndex?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Right-side modal drawer. Fixed, full-height, configurable width.
 * Renders with role=dialog + aria-modal for screen readers.
 */
export function ModalDrawer({
  children,
  ariaLabel,
  width = "360px",
  zIndex = 20,
  className = "drawer",
  style,
}: ModalDrawerProps) {
  return (
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width,
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
        zIndex,
        display: "flex",
        flexDirection: "column",
        padding: "20px",
        gap: "16px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
