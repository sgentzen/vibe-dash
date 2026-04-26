import type { CSSProperties } from "react";

interface ModalBackdropProps {
  onClick?: () => void;
  zIndex?: number;
  style?: CSSProperties;
}

/**
 * Full-viewport dark backdrop for modals/drawers.
 * Default zIndex: 10. Click-through closes via onClick.
 */
export function ModalBackdrop({ onClick, zIndex = 10, style }: ModalBackdropProps) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex,
        ...style,
      }}
    />
  );
}
