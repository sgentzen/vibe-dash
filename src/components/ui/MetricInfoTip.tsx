import { useState, useId } from "react";

interface Props {
  text: string;
}

export function MetricInfoTip({ text }: Props) {
  const [visible, setVisible] = useState(false);
  const tipId = useId();

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label="Metric calculation info"
        aria-describedby={visible ? tipId : undefined}
        style={{
          background: "none",
          border: "none",
          cursor: "help",
          color: "var(--text-muted)",
          fontSize: "11px",
          padding: "0 2px",
          lineHeight: 1,
        }}
      >
        ⓘ
      </button>
      {visible && (
        <span
          id={tipId}
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "6px 8px",
            fontSize: "11px",
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            maxWidth: "220px",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            lineHeight: "1.4",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
