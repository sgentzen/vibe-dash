import type { CSSProperties } from "react";
import { CardWrapper } from "../ui/Card";

// Shared across every card's error state — polling refetches all dashboard
// cards on each generation, so "retries automatically" holds for all of them.
const RETRY_HINT = "The dashboard will retry automatically, or retry now.";

interface CardErrorProps {
  /** Section title, kept identical to the card it replaces so the slot reads the same. */
  title: string;
  onRetry: () => void;
  /** Lead sentence naming what failed, e.g. "Couldn't load cost data." */
  lead?: string;
  style?: CSSProperties;
}

/**
 * Inline per-card error state with a Retry control. Rendered in place of a card
 * whose fetch failed so the failure is visible instead of a silent blank —
 * the dashboard's "no silent card failures" contract.
 */
export function CardError({ title, onRetry, lead = "Couldn't load this data.", style }: Readonly<CardErrorProps>) {
  return (
    <CardWrapper title={title} style={style}>
      <div style={{ color: "var(--status-danger)", fontSize: "12px", marginBottom: "8px" }}>
        {lead} {RETRY_HINT}
      </div>
      <button
        onClick={onRetry}
        style={{
          background: "transparent",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          padding: "4px 12px",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "12px",
        }}
      >
        Retry
      </button>
    </CardWrapper>
  );
}
