#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb, resolveDbPath } from "../db/index.js";
import { createMcpServer } from "./server.js";

const DB_PATH = resolveDbPath();
// stdio transport: server logs go to stderr to avoid corrupting the JSON-RPC stream.
process.stderr.write(`[mcp/stdio] Opening database: ${DB_PATH}\n`);
const db = openDb(DB_PATH);
const handle = createMcpServer(db);

const transport = new StdioServerTransport();
process.on("exit", () => handle.cleanup());
await handle.server.connect(transport);
