#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDb } from "../db.js";
import { createMcpServer } from "./server.js";

const DB_PATH = process.env.VIBE_DASH_DB ?? "vibe-dash.db";
const db = openDb(DB_PATH);
const server = createMcpServer(db);

const transport = new StdioServerTransport();
await server.connect(transport);
