export type MilestoneHealthStatus = "on_track" | "at_risk" | "behind";

export interface ComputeMilestoneHealthInput {
  /** Completion ratio in [0, 1]. */
  progress: number;
  /** ISO 8601 timestamp. */
  created_at: string;
  /** ISO 8601 date or null. */
  target_date: string | null;
  now: Date;
}

// See docs/decisions/milestone-health-formula.md for the rationale and bug catalog
// behind the four-bucket logic and the 15%/30% delta thresholds.
const AT_RISK_DELTA = -0.15;
const BEHIND_DELTA = -0.30;

export function computeMilestoneHealth({
  progress,
  created_at,
  target_date,
  now,
}: ComputeMilestoneHealthInput): MilestoneHealthStatus {
  if (progress >= 1) return "on_track";

  if (target_date) {
    const target = new Date(target_date).getTime();
    if (now.getTime() > target) return "behind";

    const created = new Date(created_at).getTime();
    const span = target - created;
    if (span <= 0) {
      // Degenerate window (target ≤ created); treat any incomplete progress as at_risk.
      return "at_risk";
    }
    const elapsed = (now.getTime() - created) / span;
    const delta = progress - elapsed;
    if (delta < BEHIND_DELTA) return "behind";
    if (delta < AT_RISK_DELTA) return "at_risk";
    return "on_track";
  }

  // No target_date with incomplete progress — undated milestones can't be "on track."
  return "at_risk";
}
