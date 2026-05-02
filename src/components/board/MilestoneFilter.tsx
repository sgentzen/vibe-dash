import type { Milestone } from "../../types";

interface MilestoneFilterProps {
  milestones: Milestone[];
  selectedMilestoneId: string | null;
  onSelect: (id: string | null) => void;
}

export function MilestoneFilter({ milestones, selectedMilestoneId, onSelect }: MilestoneFilterProps) {
  const statusOrder: Record<string, number> = { open: 0, achieved: 1 };
  const sorted = [...milestones].sort(
    (a, b) => (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
  );

  return (
    <select
      value={selectedMilestoneId ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      aria-label="Filter by milestone"
      style={{
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        color: selectedMilestoneId ? "var(--accent-blue)" : "var(--text-secondary)",
        padding: "4px 8px",
        fontSize: "12px",
        cursor: "pointer",
        maxWidth: "250px",
      }}
    >
      <option value="">All Milestones ({milestones.length})</option>
      {sorted.map((m) => {
        const icon = m.status === "achieved" ? "\u2713" : "\u25cf";
        return (
          <option key={m.id} value={m.id}>
            {icon} {m.name}
          </option>
        );
      })}
    </select>
  );
}
