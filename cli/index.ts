#!/usr/bin/env node
/**
 * vibe-dash CLI — lightweight companion for the Vibe Dash dashboard.
 * Shares the same SQLite database. No server needed.
 *
 * Usage:
 *   npx ts-node cli/index.ts list [projects|tasks|sprints]
 *   npx ts-node cli/index.ts add-task --project <name> --title <title> [--priority high] [--sprint <name>]
 *   npx ts-node cli/index.ts status [project-name]
 *   npx ts-node cli/index.ts agents
 */

import { resolve } from "path";
import Database from "better-sqlite3";
import { initDb, listProjects, listTasks, listSprints, createTask, listAgents, getAgentHealthStatus, getSprintCapacity, getActiveBlockers } from "../server/db/index.js";

// ─── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags: Record<string, string> = {};
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    flags[key] = args[i + 1] ?? "";
    i++;
  } else {
    positional.push(args[i]);
  }
}

const dbPath = resolve(flags.db ?? "./vibe-dash.db");
const command = positional[0] ?? "help";
const subcommand = positional[1] ?? "";

// ─── Colors ──────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

// ─── Open DB ─────────────────────────────────────────────────────────────────

let db: Database.Database;
try {
  db = new Database(dbPath);
  initDb(db);
} catch (e) {
  console.error(`${RED}Error:${RESET} Cannot open database at ${dbPath}`);
  console.error("Use --db /path/to/vibe-dash.db to specify a different path.");
  process.exit(1);
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdList() {
  const target = subcommand || "tasks";

  if (target === "projects") {
    const projects = listProjects(db);
    console.log(`${BOLD}${CYAN}Projects (${projects.length})${RESET}`);
    console.log(`${DIM}${"─".repeat(60)}${RESET}`);
    for (const p of projects) {
      console.log(`  ${BOLD}${p.name}${RESET}  ${DIM}${p.id.slice(0, 8)}${RESET}  ${p.description ?? ""}`);
    }
  } else if (target === "sprints") {
    const sprints = listSprints(db);
    console.log(`${BOLD}${CYAN}Sprints (${sprints.length})${RESET}`);
    console.log(`${DIM}${"─".repeat(60)}${RESET}`);
    for (const s of sprints) {
      const color = s.status === "active" ? GREEN : s.status === "completed" ? DIM : YELLOW;
      console.log(`  ${color}${pad(s.status, 10)}${RESET} ${BOLD}${s.name}${RESET}  ${DIM}${s.id.slice(0, 8)}${RESET}`);
    }
  } else {
    const projectName = flags.project;
    const projects = listProjects(db);
    const project = projectName ? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase()) : undefined;
    const tasks = listTasks(db, project ? { project_id: project.id } : undefined);
    const topLevel = tasks.filter((t) => !t.parent_task_id);

    console.log(`${BOLD}${CYAN}Tasks (${topLevel.length})${RESET}${project ? ` — ${project.name}` : ""}`);
    console.log(`${DIM}${"─".repeat(80)}${RESET}`);
    console.log(`  ${DIM}${pad("STATUS", 12)}${pad("PRIORITY", 10)}${pad("TITLE", 40)}${pad("DUE", 12)}${RESET}`);

    const statusColor: Record<string, string> = { done: GREEN, in_progress: BLUE, blocked: RED, planned: DIM };
    const priColor: Record<string, string> = { urgent: RED, high: YELLOW, medium: RESET, low: DIM };

    for (const t of topLevel) {
      const sc = statusColor[t.status] ?? RESET;
      const pc = priColor[t.priority] ?? RESET;
      console.log(`  ${sc}${pad(t.status, 12)}${RESET}${pc}${pad(t.priority, 10)}${RESET}${pad(t.title, 40)}${DIM}${t.due_date ?? "-"}${RESET}`);
    }
  }
}

function cmdAddTask() {
  const projectName = flags.project;
  const title = flags.title;
  const priority = flags.priority ?? "medium";
  const sprintName = flags.sprint;

  const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
  if (!projectName || !title) {
    console.error(`${RED}Usage:${RESET} add-task --project <name> --title <title> [--priority high] [--sprint <name>]`);
    process.exit(1);
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    console.error(`${RED}Error:${RESET} Invalid priority "${priority}". Must be one of: ${VALID_PRIORITIES.join(", ")}`);
    process.exit(1);
  }

  const projects = listProjects(db);
  const project = projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
  if (!project) {
    console.error(`${RED}Error:${RESET} Project "${projectName}" not found.`);
    process.exit(1);
  }

  let sprintId: string | undefined;
  if (sprintName) {
    const sprints = listSprints(db, project.id);
    const sprint = sprints.find((s) => s.name.toLowerCase() === sprintName.toLowerCase());
    if (sprint) sprintId = sprint.id;
  }

  const task = createTask(db, {
    project_id: project.id,
    title,
    description: null,
    priority: priority as "low" | "medium" | "high" | "urgent",
    sprint_id: sprintId ?? null,
  });

  console.log(`${GREEN}Created task:${RESET} ${task.title} ${DIM}(${task.id.slice(0, 8)})${RESET}`);
}

function cmdStatus() {
  const projectName = subcommand || undefined;
  const projects = listProjects(db);
  const project = projectName ? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase()) : projects[0];

  if (!project) {
    console.error(`${RED}Error:${RESET} No projects found.`);
    process.exit(1);
  }

  const tasks = listTasks(db, { project_id: project.id }).filter((t) => !t.parent_task_id);
  const byStatus: Record<string, number> = { planned: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  const sprints = listSprints(db, project.id);
  const activeSprint = sprints.find((s) => s.status === "active");
  const blockers = getActiveBlockers(db);

  console.log(`${BOLD}${CYAN}Status: ${project.name}${RESET}`);
  console.log(`${DIM}${"─".repeat(40)}${RESET}`);
  console.log(`  ${DIM}Planned:     ${RESET}${byStatus.planned}`);
  console.log(`  ${BLUE}In Progress: ${RESET}${byStatus.in_progress}`);
  console.log(`  ${RED}Blocked:     ${RESET}${byStatus.blocked}`);
  console.log(`  ${GREEN}Done:        ${RESET}${byStatus.done}`);
  console.log(`  ${DIM}${"─".repeat(30)}${RESET}`);
  console.log(`  Total:       ${tasks.length}`);

  if (activeSprint) {
    const cap = getSprintCapacity(db, activeSprint.id);
    console.log(`\n  ${BOLD}Active Sprint:${RESET} ${activeSprint.name}`);
    console.log(`  Tasks: ${cap.completed_count}/${cap.task_count} done`);
    console.log(`  Points: ${cap.completed_points}/${cap.total_estimated} completed`);
  }

  if (blockers.length > 0) {
    console.log(`\n  ${RED}${BOLD}Active Blockers (${blockers.length}):${RESET}`);
    for (const b of blockers.slice(0, 5)) {
      console.log(`    ${RED}- ${b.reason}${RESET}`);
    }
  }
}

function cmdAgents() {
  const agents = listAgents(db);
  console.log(`${BOLD}${CYAN}Agents (${agents.length})${RESET}`);
  console.log(`${DIM}${"─".repeat(60)}${RESET}`);
  console.log(`  ${DIM}${pad("NAME", 20)}${pad("MODEL", 15)}${pad("HEALTH", 10)}${pad("LAST SEEN", 20)}${RESET}`);

  const healthColor: Record<string, string> = { active: GREEN, idle: YELLOW, offline: DIM };

  for (const a of agents) {
    const health = getAgentHealthStatus(a.last_seen_at);
    const hc = healthColor[health] ?? RESET;
    const lastSeen = new Date(a.last_seen_at).toLocaleString();
    console.log(`  ${BOLD}${pad(a.name, 20)}${RESET}${DIM}${pad(a.model ?? "-", 15)}${RESET}${hc}${pad(health, 10)}${RESET}${DIM}${lastSeen}${RESET}`);
  }
}

function cmdHelp() {
  console.log(`${BOLD}${CYAN}vibe-dash${RESET} — CLI companion for Vibe Dash`);
  console.log();
  console.log("Commands:");
  console.log(`  ${BOLD}list${RESET} [projects|tasks|sprints]  List entities`);
  console.log(`  ${BOLD}add-task${RESET} --project <n> --title <t>  Create a task`);
  console.log(`  ${BOLD}status${RESET} [project-name]           Project status summary`);
  console.log(`  ${BOLD}agents${RESET}                          List agents with health`);
  console.log();
  console.log("Flags:");
  console.log(`  --db <path>     Database file (default: ./vibe-dash.db)`);
  console.log(`  --project <n>   Filter by project name`);
  console.log(`  --priority <p>  Task priority (low|medium|high|urgent)`);
  console.log(`  --sprint <n>    Sprint name for add-task`);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

switch (command) {
  case "list": cmdList(); break;
  case "add-task": cmdAddTask(); break;
  case "status": cmdStatus(); break;
  case "agents": cmdAgents(); break;
  default: cmdHelp(); break;
}
