import type { CSSProperties, ReactNode } from "react";
import { cardStyle, sectionHeader } from "../../styles/shared.js";

const defaultHeaderStyle: CSSProperties = { ...sectionHeader, fontSize: "13px" };

interface CardWrapperProps {
  children: ReactNode;
  title?: ReactNode;
  style?: CSSProperties;
  headerStyle?: CSSProperties;
}

/**
 * Shared dashboard card shell — bg-secondary, 1px border, 8px radius, 16px padding.
 * Optionally renders a section header. Pass `style` to override/extend the base.
 */
export function CardWrapper({ children, title, style, headerStyle }: CardWrapperProps) {
  const merged: CSSProperties = style ? { ...cardStyle, ...style } : cardStyle;
  return (
    <div style={merged}>
      {title !== undefined && (
        <div style={headerStyle ? { ...defaultHeaderStyle, ...headerStyle } : defaultHeaderStyle}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
