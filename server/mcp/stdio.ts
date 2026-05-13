#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "../db/index.js";
import { createMcpServer } from "./server.js";
import { resolveDbPath } from "../utils/resolveDbPath.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DB_PATH = resolveDbPath(PROJECT_ROOT);
const db = openDb(DB_PATH);
const handle = createMcpServer(db);

const transport = new StdioServerTransport();
process.on("exit", () => handle.cleanup());
await handle.server.connect(transport);
