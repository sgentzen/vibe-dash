import type { TaskStatus } from "../../types";

export const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  done: "var(--accent-green)",
  in_progress: "var(--accent-blue)",
  blocked: "var(--accent-yellow)",
  planned: "var(--text-muted)",
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const BAR_HEIGHT = 24;
export const ROW_HEIGHT = 32;
export const DEFAULT_LABEL_WIDTH = 320;
export const MIN_LABEL_WIDTH = 160;
export const MAX_LABEL_WIDTH = 500;
export const MONTH_HEADER_HEIGHT = 24;
export const WEEK_HEADER_HEIGHT = 22;
export const HEADER_HEIGHT = MONTH_HEADER_HEIGHT + WEEK_HEADER_HEIGHT;
export const GROUP_HEADER_HEIGHT = 32;

export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const STATUS_OPACITY: Record<string, number> = {
  done: 0.4,
  blocked: 0.6,
  in_progress: 1,
  planned: 0.8,
};
