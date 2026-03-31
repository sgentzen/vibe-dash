#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "../db.js";
import { createMcpServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DB_PATH = process.env.VIBE_DASH_DB ?? path.join(PROJECT_ROOT, "vibe-dash.db");
const db = openDb(DB_PATH);
const handle = createMcpServer(db);

const transport = new StdioServerTransport();
process.on("exit", () => handle.cleanup());
await handle.server.connect(transport);
