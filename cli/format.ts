/**
 * Pure formatting helpers for the vibe-dash CLI.
 * No side effects, no DB access. Each helper takes data in and returns a string.
 */

import type { Project, Milestone, Task, Agent, Blocker } from "../server/types.js";

// ─── Colors ──────────────────────────────────────────────────────────────────

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const CYAN = "\x1b[36m";

// ─── Primitives ──────────────────────────────────────────────────────────────

export function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

export function hr(len: number): string {
  return `${DIM}${"─".repeat(len)}${RESET}`;
}

export function header(title: string): string {
  return `${BOLD}${CYAN}${title}${RESET}`;
}

// ─── Status / priority colors ────────────────────────────────────────────────

export const STATUS_COLOR: Record<string, string> = {
  done: GREEN,
  in_progress: BLUE,
  blocked: RED,
  planned: DIM,
};

export const PRIORITY_COLOR: Record<string, string> = {
  urgent: RED,
  high: YELLOW,
  medium: RESET,
  low: DIM,
};

export const HEALTH_COLOR: Record<string, string> = {
  active: GREEN,
  idle: YELLOW,
  offline: DIM,
};

export function milestoneStatusColor(status: string): string {
  if (status === "open") return GREEN;
  if (status === "achieved") return DIM;
  return YELLOW;
}

// ─── Row formatters ──────────────────────────────────────────────────────────

export function formatProjectRow(p: Project): string {
  return `  ${BOLD}${p.name}${RESET}  ${DIM}${p.id.slice(0, 8)}${RESET}  ${p.description ?? ""}`;
}

export function formatMilestoneRow(m: Milestone): string {
  const color = milestoneStatusColor(m.status);
  return `  ${color}${pad(m.status, 10)}${RESET} ${BOLD}${m.name}${RESET}  ${DIM}${m.id.slice(0, 8)}${RESET}`;
}

export function formatTaskHeaderRow(): string {
  return `  ${DIM}${pad("STATUS", 12)}${pad("PRIORITY", 10)}${pad("TITLE", 40)}${pad("DUE", 12)}${RESET}`;
}

export function formatTaskRow(t: Task): string {
  const sc = STATUS_COLOR[t.status] ?? RESET;
  const pc = PRIORITY_COLOR[t.priority] ?? RESET;
  return `  ${sc}${pad(t.status, 12)}${RESET}${pc}${pad(t.priority, 10)}${RESET}${pad(t.title, 40)}${DIM}${t.due_date ?? "-"}${RESET}`;
}

export function formatAgentHeaderRow(): string {
  return `  ${DIM}${pad("NAME", 20)}${pad("MODEL", 15)}${pad("HEALTH", 10)}${pad("LAST SEEN", 20)}${RESET}`;
}

export function formatAgentRow(a: Agent, health: string, lastSeen: string): string {
  const hc = HEALTH_COLOR[health] ?? RESET;
  return `  ${BOLD}${pad(a.name, 20)}${RESET}${DIM}${pad(a.model ?? "-", 15)}${RESET}${hc}${pad(health, 10)}${RESET}${DIM}${lastSeen}${RESET}`;
}

// ─── Status view ─────────────────────────────────────────────────────────────

export interface StatusSummary {
  projectName: string;
  byStatus: Record<string, number>;
  total: number;
  openMilestone?: { name: string; completed_count: number; task_count: number; completion_pct: number };
  blockers: Blocker[];
}

export function formatStatusSummary(s: StatusSummary): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}Status: ${s.projectName}${RESET}`);
  lines.push(`${DIM}${"─".repeat(40)}${RESET}`);
  lines.push(`  ${DIM}Planned:     ${RESET}${s.byStatus.planned ?? 0}`);
  lines.push(`  ${BLUE}In Progress: ${RESET}${s.byStatus.in_progress ?? 0}`);
  lines.push(`  ${RED}Blocked:     ${RESET}${s.byStatus.blocked ?? 0}`);
  lines.push(`  ${GREEN}Done:        ${RESET}${s.byStatus.done ?? 0}`);
  lines.push(`  ${DIM}${"─".repeat(30)}${RESET}`);
  lines.push(`  Total:       ${s.total}`);

  if (s.openMilestone) {
    lines.push("");
    lines.push(`  ${BOLD}Open Milestone:${RESET} ${s.openMilestone.name}`);
    lines.push(`  Tasks: ${s.openMilestone.completed_count}/${s.openMilestone.task_count} done`);
    lines.push(`  Progress: ${s.openMilestone.completion_pct}% completed`);
  }

  if (s.blockers.length > 0) {
    lines.push("");
    lines.push(`  ${RED}${BOLD}Active Blockers (${s.blockers.length}):${RESET}`);
    for (const b of s.blockers.slice(0, 5)) {
      lines.push(`    ${RED}- ${b.reason}${RESET}`);
    }
  }

  return lines.join("\n");
}

// ─── Help ────────────────────────────────────────────────────────────────────

export function formatHelp(): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${CYAN}vibe-dash${RESET} — CLI companion for Vibe Dash`);
  lines.push("");
  lines.push("Commands:");
  lines.push(`  ${BOLD}list${RESET} [projects|tasks|milestones]  List entities`);
  lines.push(`  ${BOLD}add-task${RESET} --project <n> --title <t>  Create a task`);
  lines.push(`  ${BOLD}status${RESET} [project-name]            Project status summary`);
  lines.push(`  ${BOLD}agents${RESET}                           List agents with health`);
  lines.push("");
  lines.push("Flags:");
  lines.push(`  --db <path>      Database file (default: ./vibe-dash.db)`);
  lines.push(`  --project <n>    Filter by project name`);
  lines.push(`  --priority <p>   Task priority (low|medium|high|urgent)`);
  lines.push(`  --milestone <n>  Milestone name for add-task`);
  return lines.join("\n");
}
