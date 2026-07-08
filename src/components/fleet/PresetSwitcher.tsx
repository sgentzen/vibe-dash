import type { FleetPreset } from "../../state/types";

const PRESETS: { key: FleetPreset; label: string; hint: string }[] = [
  { key: "overview", label: "Overview", hint: "go" },
  { key: "agents", label: "Agents", hint: "ga" },
];

interface PresetSwitcherProps {
  active: FleetPreset;
  onChange: (p: FleetPreset) => void;
}

export function PresetSwitcher({ active, onChange }: Readonly<PresetSwitcherProps>) {
  return (
    <div
      role="tablist"
      aria-label="Fleet view presets"
      style={{
        display: "flex",
        gap: "2px",
        background: "var(--bg-tertiary)",
        borderRadius: "6px",
        padding: "2px",
        margin: "8px 16px",
        width: "fit-content",
      }}
    >
      {PRESETS.map((p) => {
        const isActive = active === p.key;
        return (
          <button
            key={p.key}
            role="tab"
            aria-selected={isActive}
            aria-label={`${p.label} preset (shortcut ${p.hint})`}
            onClick={() => onChange(p.key)}
            style={{
              background: isActive ? "var(--bg-primary)" : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              border: "none",
              borderRadius: "4px",
              padding: "4px 12px",
              fontSize: "12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>{p.label}</span>
            <kbd
              aria-hidden
              style={{
                fontSize: "10px",
                color: "var(--text-muted)",
                fontFamily: "inherit",
                background: isActive ? "var(--bg-tertiary)" : "transparent",
                padding: "0 4px",
                borderRadius: "2px",
              }}
            >
              {p.hint}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
