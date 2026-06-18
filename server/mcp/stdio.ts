#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "../db/index.js";
import { createMcpServer } from "./server.js";
import { resolveDbPath } from "../db/path.js";

const DB_PATH = resolveDbPath();
const db = openDb(DB_PATH);
const handle = createMcpServer(db);

const transport = new StdioServerTransport();
process.on("exit", () => handle.cleanup());
await handle.server.connect(transport);
