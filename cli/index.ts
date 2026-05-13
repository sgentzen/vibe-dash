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

import { resolve, join } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { initDb, listProjects, listTasks, listMilestones, createTask, listAgents, getAgentHealthStatus, getMilestoneProgress, getActiveBlockers } from "../server/db/index.js";
import { resolveDbPath } from "../server/utils/resolveDbPath.js";
import { generateDigest, isAiConfigured } from "../server/intelligence.js";
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
  formatCompactStatus,
  formatHelp,
} from "./format.js";
import type { ProjectSnapshot } from "./format.js";

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

const dbPath = resolveDbPath(flags.db);
const command = positional[0] ?? "help";
const subcommand = positional[1] ?? "";

// ─── Open DB (skipped for install-hooks which talks to the server via HTTP) ──

let db!: Database.Database;
if (command !== "install-hooks") {
  try {
    db = new Database(dbPath);
    initDb(db);
  } catch (e) {
    console.error(`${RED}Error:${RESET} Cannot open database at ${dbPath}`);
    console.error("Use --db /path/to/vibe-dash.db to specify a different path.");
    process.exit(1);
  }
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
  const allProjects = listProjects(db);

  if (!allProjects.length) {
    console.error(`${RED}Error:${RESET} No projects found.`);
    process.exit(1);
  }

  // Named project → detailed single-project view (existing behavior)
  if (projectName) {
    const project = allProjects.find((p) => p.name.toLowerCase() === projectName.toLowerCase());
    if (!project) {
      console.error(`${RED}Error:${RESET} Project "${projectName}" not found.`);
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
          return { name: openMilestone.name, completed_count: progress.completed_count, task_count: progress.task_count, completion_pct: progress.completion_pct };
        })()
      : undefined;
    console.log(formatStatusSummary({ projectName: project.name, byStatus, total: tasks.length, openMilestone: openMilestoneSummary, blockers }));
    return;
  }

  // No arg → compact all-projects view (≤10 lines)
  const snapshots: ProjectSnapshot[] = allProjects.map((p) => {
    const tasks = listTasks(db, { project_id: p.id }).filter((t) => !t.parent_task_id);
    const counts = { planned: 0, in_progress: 0, blocked: 0, done: 0 };
    for (const t of tasks) counts[t.status as keyof typeof counts] = (counts[t.status as keyof typeof counts] ?? 0) + 1;
    const openMilestone = listMilestones(db, p.id).find((m) => m.status === "open");
    const milestone = openMilestone
      ? { name: openMilestone.name, completion_pct: getMilestoneProgress(db, openMilestone.id).completion_pct }
      : undefined;
    return { name: p.name, ...counts, openMilestone: milestone };
  });

  const agents = listAgents(db);
  const agentCounts = { active: 0, idle: 0, offline: 0 };
  for (const a of agents) {
    const h = getAgentHealthStatus(a.last_seen_at);
    agentCounts[h]++;
  }
  const openBlockers = getActiveBlockers(db).length;

  console.log(formatCompactStatus({ projects: snapshots, activeAgents: agentCounts.active, idleAgents: agentCounts.idle, offlineAgents: agentCounts.offline, openBlockers }));
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

async function cmdDigest() {
  const outputDir = resolve(flags["output-dir"] ?? "./digests");
  const date = new Date().toISOString().slice(0, 10);
  const outPath = join(outputDir, `${date}.md`);

  mkdirSync(outputDir, { recursive: true });

  let content: string;
  if (isAiConfigured()) {
    const projectName = flags.project;
    const projectId = projectName
      ? listProjects(db).find((p) => p.name.toLowerCase() === projectName.toLowerCase())?.id
      : undefined;
    process.stdout.write("Generating AI digest…");
    content = await generateDigest(db, "daily", projectId);
    process.stdout.write(" done.\n");
  } else {
    content = buildStaticDigest(db, date);
  }
  writeFileSync(outPath, content, "utf8");
  console.log(`${GREEN}Digest written:${RESET} ${outPath}`);
}

function buildStaticDigest(db: Database.Database, date: string): string {
  const projects = listProjects(db);
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const lines: string[] = [`# Daily Digest — ${date}`, ""];

  for (const p of projects) {
    const tasks = listTasks(db, { project_id: p.id }).filter((t) => !t.parent_task_id);
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    const done24h = tasks.filter((t) => t.status === "done" && t.updated_at >= since);
    const blocked = tasks.filter((t) => t.status === "blocked");
    const openMilestone = listMilestones(db, p.id).find((m) => m.status === "open");
    const pct = openMilestone ? getMilestoneProgress(db, openMilestone.id).completion_pct : null;

    lines.push(`## ${p.name}`);
    if (openMilestone) lines.push(`**Milestone:** ${openMilestone.name}${pct !== null ? ` (${pct}%)` : ""}`);
    lines.push(`**In progress:** ${inProgress.length}  **Completed today:** ${done24h.length}  **Blocked:** ${blocked.length}`);
    if (done24h.length > 0) {
      lines.push("", "### Completed today");
      for (const t of done24h.slice(0, 10)) lines.push(`- ${t.title}`);
    }
    if (inProgress.length > 0) {
      lines.push("", "### In progress");
      for (const t of inProgress.slice(0, 10)) lines.push(`- ${t.title}`);
    }
    if (blocked.length > 0) {
      lines.push("", "### Blocked");
      for (const t of blocked.slice(0, 5)) lines.push(`- ${t.title}`);
    }
    lines.push("");
  }

  const activeBlockers = getActiveBlockers(db);
  if (activeBlockers.length > 0) {
    lines.push("## Active Blockers", "");
    for (const b of activeBlockers.slice(0, 10)) lines.push(`- ${b.reason}`);
    lines.push("");
  }

  const agents = listAgents(db);
  const activeAgents = agents.filter((a) => getAgentHealthStatus(a.last_seen_at) === "active");
  lines.push(`## Agents`, `${activeAgents.length} active / ${agents.length} total`, "");

  return lines.join("\n");
}

// ─── install-hooks ───────────────────────────────────────────────────────────

async function installHooks(): Promise<void> {
  const serverUrl = (flags.server ?? "http://localhost:3001").replace(/\/$/, "");

  // 1. Verify server is reachable
  let token: string;
  try {
    const check = await fetch(`${serverUrl}/api/auth/status`);
    if (!check.ok) throw new Error(`server returned ${check.status}`);
  } catch (e) {
    throw new Error(`Cannot reach vibe-dash server at ${serverUrl}. Is it running?\n  ${(e as Error).message}`);
  }

  // 2. Find or create a claude_code ingestion source, then rotate to get a fresh token
  const sourceName = "claude-code-hooks";
  const listRes = await fetch(`${serverUrl}/api/ingest/sources`);
  if (!listRes.ok) throw new Error(`Failed to list ingestion sources: ${listRes.status}`);
  const sources = (await listRes.json()) as { id: string; name: string }[];
  const existing = sources.find((s) => s.name === sourceName);

  if (existing) {
    const rotateRes = await fetch(`${serverUrl}/api/ingest/sources/${existing.id}/rotate`, { method: "POST" });
    if (!rotateRes.ok) throw new Error(`Failed to rotate token: ${rotateRes.status} ${await rotateRes.text()}`);
    const rotated = (await rotateRes.json()) as { token: string };
    token = rotated.token;
  } else {
    const createRes = await fetch(`${serverUrl}/api/ingest/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: sourceName, kind: "claude_code" }),
    });
    if (!createRes.ok) throw new Error(`Failed to create ingestion source: ${createRes.status} ${await createRes.text()}`);
    const created = (await createRes.json()) as { token: string };
    token = created.token;
  }

  // 3. Build hook command (inline node, works cross-platform, requires Node >=18)
  const endpoint = `${serverUrl}/api/ingest/claude_code`;
  const hookCmd = `node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{fetch('${endpoint}',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:d}).catch(()=>{})});"`;

  // 4. Merge into ~/.claude/settings.json
  const settingsDir = join(homedir(), ".claude");
  const settingsPath = join(settingsDir, "settings.json");

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      throw new Error(`Cannot parse ${settingsPath} — fix the JSON first`);
    }
  } else {
    mkdirSync(settingsDir, { recursive: true });
  }

  const hookEntry = { type: "command", command: hookCmd };
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  // PostToolUse: capture every tool call — replace existing vibe-dash entry to refresh token
  const postToolUse = (hooks.PostToolUse ?? []) as { matcher?: string; hooks: unknown[] }[];
  const vibeIdx = postToolUse.findIndex((e) => e.matcher === ".*" && JSON.stringify(e.hooks).includes("api/ingest/claude_code"));
  if (vibeIdx >= 0) {
    postToolUse[vibeIdx] = { matcher: ".*", hooks: [hookEntry] };
  } else {
    postToolUse.push({ matcher: ".*", hooks: [hookEntry] });
  }
  hooks.PostToolUse = postToolUse;

  // Stop: capture session end — replace existing vibe-dash entry to refresh token
  const stop = (hooks.Stop ?? []) as { hooks: unknown[] }[];
  const stopIdx = stop.findIndex((e) => JSON.stringify(e.hooks).includes("api/ingest/claude_code"));
  if (stopIdx >= 0) {
    stop[stopIdx] = { hooks: [hookEntry] };
  } else {
    stop.push({ hooks: [hookEntry] });
  }
  hooks.Stop = stop;

  settings.hooks = hooks;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");

  console.log(`${GREEN}✓ Hooks installed${RESET} → ${settingsPath}`);
  console.log(`  Ingestion source: ${sourceName} ${existing ? DIM + "(token rotated)" + RESET : ""}`);
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Every PostToolUse + Stop event will POST to vibe-dash.`);
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

async function main() {
  switch (command) {
    case "list": cmdList(); break;
    case "add-task": cmdAddTask(); break;
    case "status": cmdStatus(); break;
    case "agents": cmdAgents(); break;
    case "digest": await cmdDigest(); break;
    case "install-hooks": await installHooks(); break;
    default: cmdHelp(); break;
  }
}

main().catch((err: Error) => {
  console.error(`${RED}Error:${RESET} ${err.message}`);
  process.exit(1);
});
