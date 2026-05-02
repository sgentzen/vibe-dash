interface TaskDrawerActionsProps {
  saving: boolean;
  showMarkDone: boolean;
  onSave: () => void;
  onMarkDone: () => void;
}

export function TaskDrawerActions({ saving, showMarkDone, onSave, onMarkDone }: TaskDrawerActionsProps) {
  return (
    <div style={{ marginTop: "auto", display: "flex", gap: "10px" }}>
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          flex: 1,
          background: "var(--green-bg)",
          border: "1px solid var(--green-border)",
          color: "var(--accent-green)",
          borderRadius: "6px",
          padding: "8px",
          fontSize: "13px",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {showMarkDone && (
        <button
          onClick={onMarkDone}
          disabled={saving}
          style={{
            flex: 1,
            background: "transparent",
            border: "1px solid var(--accent-green)",
            color: "var(--accent-green)",
            borderRadius: "6px",
            padding: "8px",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          Mark Done
        </button>
      )}
    </div>
  );
}
