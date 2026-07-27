#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb, SchemaTooNewError } from "../db/index.js";
import { createMcpServer } from "./server.js";
import { resolveDbPath } from "../db/path.js";

const DB_PATH = resolveDbPath();

// stdout is the MCP transport — diagnostics must go to stderr or they corrupt
// the protocol stream. A bare throw here would dump a stack trace into the
// client's log with no indication of what to actually do about it.
function openDbOrExit(): ReturnType<typeof openDb> {
  try {
    return openDb(DB_PATH);
  } catch (err) {
    if (err instanceof SchemaTooNewError) {
      console.error(`vibe-dash: ${err.message}`);
      console.error(`vibe-dash: database at ${DB_PATH}`);
    } else {
      console.error(`vibe-dash: cannot open database at ${DB_PATH}`);
      console.error(`vibe-dash: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

const db = openDbOrExit();
const handle = createMcpServer(db);

const transport = new StdioServerTransport();
process.on("exit", () => handle.cleanup());
await handle.server.connect(transport);
