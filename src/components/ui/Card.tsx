import type { CSSProperties, ReactNode } from "react";
import { cardStyle, sectionHeader } from "../../styles/shared.js";

const defaultHeaderStyle: CSSProperties = { ...sectionHeader, fontSize: "13px" };

interface CardWrapperProps {
  children: ReactNode;
  title?: ReactNode;
  /** Optional control rendered right-aligned in the header row (e.g. a selector). */
  action?: ReactNode;
  style?: CSSProperties;
  headerStyle?: CSSProperties;
}

/**
 * Shared dashboard card shell — bg-secondary, 1px border, 8px radius, 16px padding.
 * Optionally renders a section header. Pass `style` to override/extend the base.
 */
export function CardWrapper({ children, title, action, style, headerStyle }: Readonly<CardWrapperProps>) {
  const merged: CSSProperties = style ? { ...cardStyle, ...style } : cardStyle;
  const resolvedHeaderStyle = headerStyle ? { ...defaultHeaderStyle, ...headerStyle } : defaultHeaderStyle;
  return (
    <div style={merged}>
      {title !== undefined && (
        action === undefined ? (
          <div style={resolvedHeaderStyle}>{title}</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
            <div style={resolvedHeaderStyle}>{title}</div>
            {action}
          </div>
        )
      )}
      {children}
    </div>
  );
}
