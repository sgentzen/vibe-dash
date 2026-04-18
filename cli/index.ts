#!/usr/bin/env node
/**
 * vibe-dash CLI — lightweight companion for the Vibe Dash dashboard.
 * Shares the same SQLite database. No server needed.
 *
 * Usage:
 *   npx ts-node cli/index.ts list [projects|tasks|milestones]
 *   npx ts-node cli/index.ts add-task --project <name> --title <title> [--priority high] [--milestone <name>]
 *   npx ts-node cli/index.ts status [project-name]
 *   npx ts-node cli/index.ts agents
 */

import { resolve } from "path";
import Database from "better-sqlite3";
import { initDb, listProjects, listTasks, listMilestones, createTask, listAgents, getAgentHealthStatus, getMilestoneProgress, getActiveBlockers } from "../server/db/index.js";
import {
  RESET,
  DIM,
  RED,
  GREEN,
  header,
  hr,
  formatProjectRow,
  formatMilestoneRow,
  formatTaskHeaderRow,
  formatTaskRow,
  formatAgentHeaderRow,
  formatAgentRow,
  formatStatusSummary,
  formatHelp,
} from "./format.js";

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
    console.log(header(`Projects (${projects.length})`));
    console.log(hr(60));
    for (const p of projects) {
      console.log(formatProjectRow(p));
    }
  } else if (target === "milestones") {
    const milestones = listMilestones(db);
    console.log(header(`Milestones (${milestones.length})`));
    console.log(hr(60));
    for (const m of milestones) {
      console.log(formatMilestoneRow(m));
    }
  } else {
    const projectName = flags.project;
    const projects = listProjects(db);
    const project = projectName ? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase()) : undefined;
    const tasks = listTasks(db, project ? { project_id: project.id } : undefined);
    const topLevel = tasks.filter((t) => !t.parent_task_id);

    console.log(`${header(`Tasks (${topLevel.length})`)}${project ? ` — ${project.name}` : ""}`);
    console.log(hr(80));
    console.log(formatTaskHeaderRow());

    for (const t of topLevel) {
      console.log(formatTaskRow(t));
    }
  }
}

function cmdAddTask() {
  const projectName = flags.project;
  const title = flags.title;
  const priority = flags.priority ?? "medium";
  const milestoneName = flags.milestone;

  const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
  if (!projectName || !title) {
    console.error(`${RED}Usage:${RESET} add-task --project <name> --title <title> [--priority high] [--milestone <name>]`);
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

  let milestoneId: string | undefined;
  if (milestoneName) {
    const milestones = listMilestones(db, project.id);
    const milestone = milestones.find((m) => m.name.toLowerCase() === milestoneName.toLowerCase());
    if (milestone) milestoneId = milestone.id;
  }

  const task = createTask(db, {
    project_id: project.id,
    title,
    description: null,
    priority: priority as "low" | "medium" | "high" | "urgent",
    milestone_id: milestoneId ?? null,
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

  const milestones = listMilestones(db, project.id);
  const openMilestone = milestones.find((m) => m.status === "open");
  const blockers = getActiveBlockers(db);

  const openMilestoneSummary = openMilestone
    ? (() => {
        const progress = getMilestoneProgress(db, openMilestone.id);
        return {
          name: openMilestone.name,
          completed_count: progress.completed_count,
          task_count: progress.task_count,
          completion_pct: progress.completion_pct,
        };
      })()
    : undefined;

  console.log(
    formatStatusSummary({
      projectName: project.name,
      byStatus,
      total: tasks.length,
      openMilestone: openMilestoneSummary,
      blockers,
    }),
  );
}

function cmdAgents() {
  const agents = listAgents(db);
  console.log(header(`Agents (${agents.length})`));
  console.log(hr(60));
  console.log(formatAgentHeaderRow());

  for (const a of agents) {
    const health = getAgentHealthStatus(a.last_seen_at);
    const lastSeen = new Date(a.last_seen_at).toLocaleString();
    console.log(formatAgentRow(a, health, lastSeen));
  }
}

function cmdHelp() {
  console.log(formatHelp());
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

switch (command) {
  case "list": cmdList(); break;
  case "add-task": cmdAddTask(); break;
  case "status": cmdStatus(); break;
  case "agents": cmdAgents(); break;
  default: cmdHelp(); break;
}
