import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// All path inputs here are operator-controlled: the VIBE_DASH_CLAUDE_HOME env
// var, the OS home directory, and names read from the filesystem. None is
// reachable from HTTP or MCP request data.
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

const CLAUDE_HOME_ENV = "VIBE_DASH_CLAUDE_HOME";

/** Where Claude Code keeps its session transcripts. */
export function resolveClaudeHome(override?: string): string {
  if (override && override.length > 0) return path.resolve(override);
  const fromEnv = process.env[CLAUDE_HOME_ENV];
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  return path.join(homedir(), ".claude", "projects");
}

/**
 * Every *.jsonl under the Claude home, recursively.
 *
 * Recursive because subagent transcripts live in nested `subagents/`
 * directories and their spend counts the same as the parent session's.
 * A missing directory yields an empty list rather than throwing: most machines
 * that run Vibe Dash without Claude Code have no such directory, and that is
 * not an error condition.
 */
export function discoverTranscripts(claudeHome: string): string[] {
  if (!fs.existsSync(claudeHome)) return [];

  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory: skip it, keep scanning the rest.
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  walk(claudeHome);
  return found.sort((a, b) => a.localeCompare(b));
}
