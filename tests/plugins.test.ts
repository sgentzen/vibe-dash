import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "http";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createPluginContext } from "../server/plugins/sandbox.js";
import { loadPluginsFromDir } from "../server/plugins/loader.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("5.3 Plugin/Extension System — sandbox", () => {
  it("createPluginContext returns a namespaced context", () => {
    const ctx = createPluginContext(db, "my-plugin");
    expect(ctx.namespace).toBe("my_plugin");
    expect(ctx.db).toBeDefined();
  });

  it("sanitizes plugin names with special characters", () => {
    const ctx = createPluginContext(db, "my-plugin@2.0/test");
    expect(ctx.namespace).toBe("my_plugin_2_0_test");
  });

  it("proxied db.prepare rewrites plugin_ table references", () => {
    const ctx = createPluginContext(db, "demo");
    // Create a plugin-namespaced table
    ctx.db.exec("CREATE TABLE IF NOT EXISTS demo_data (id TEXT PRIMARY KEY, value TEXT)");

    // prepare() through the proxy should rewrite plugin_data -> demo_data
    const stmt = ctx.db.prepare("SELECT * FROM plugin_data");
    // If rewriting works, the statement executes without 'no such table' error
    expect(() => stmt.all()).not.toThrow();
  });

  it("namespaced tables are isolated from core tables", () => {
    const ctx = createPluginContext(db, "safe");
    // Core tables (projects, tasks, etc.) are not prefixed, so they pass through
    // unchanged — plugin cannot accidentally shadow core tables via plugin_ naming
    const projects = ctx.db.prepare("SELECT * FROM projects").all();
    expect(Array.isArray(projects)).toBe(true);
  });
});

describe("5.3 Plugin/Extension System — loader", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-plugin-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when dir does not exist", async () => {
    const result = await loadPluginsFromDir("/nonexistent-dir-xyz", db);
    expect(result).toEqual([]);
  });

  it("skips subdirs without plugin.json", async () => {
    fs.mkdirSync(path.join(tmpDir, "no-manifest"));
    const result = await loadPluginsFromDir(tmpDir, db);
    expect(result).toHaveLength(0);
  });

  it("loads a valid widget plugin with no entrypoint", async () => {
    const pluginDir = path.join(tmpDir, "my-widget");
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "my-widget", version: "1.0.0", type: "widget", label: "My Widget" }),
    );
    const result = await loadPluginsFromDir(tmpDir, db);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.name).toBe("my-widget");
    expect(result[0].manifest.type).toBe("widget");
    expect(result[0].error).toBeUndefined();
  });

  it("records an error for invalid manifest (missing name)", async () => {
    const pluginDir = path.join(tmpDir, "bad-plugin");
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ version: "1.0.0", type: "widget" }),
    );
    const result = await loadPluginsFromDir(tmpDir, db);
    expect(result).toHaveLength(1);
    expect(result[0].error).toBeTruthy();
  });

  it("rejects entrypoint that escapes plugin directory", async () => {
    const pluginDir = path.join(tmpDir, "evil-plugin");
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "evil-plugin", version: "1.0.0", type: "integration", entrypoint: "../../server/index.js" }),
    );
    const result = await loadPluginsFromDir(tmpDir, db);
    expect(result).toHaveLength(1);
    expect(result[0].error).toMatch(/escapes plugin directory/);
  });
});

describe("5.3 Plugin/Extension System — REST routes", () => {
  function makeRequest(
    app: import("express").Express,
    method: string,
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      const server = createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        const options: import("http").RequestOptions = {
          hostname: "127.0.0.1",
          port: addr.port,
          path,
          method,
          headers: { "Content-Type": "application/json" },
        };
        const req = http.request(options, (res) => {
          let data = "";
          res.on("data", (c: Buffer) => { data += c; });
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode ?? 0, body: data }); }
          });
        });
        req.on("error", (err) => { server.close(); reject(err); });
        req.end();
      });
    });
  }

  it("GET /api/plugins returns plugin list", async () => {
    const expressModule = await import("express");
    const { pluginRoutes } = await import("../server/routes/plugins.js");
    const app = expressModule.default();
    app.use(expressModule.default.json());
    app.use(pluginRoutes(db, () => {}));

    const res = await makeRequest(app, "GET", "/api/plugins");
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>)).toHaveProperty("plugins");
    expect(Array.isArray((res.body as Record<string, unknown>).plugins)).toBe(true);
  });

  it("POST /api/plugins/reload returns reloaded count", async () => {
    const expressModule = await import("express");
    const { pluginRoutes } = await import("../server/routes/plugins.js");
    const app = expressModule.default();
    app.use(expressModule.default.json());
    app.use(pluginRoutes(db, () => {}));

    const res = await makeRequest(app, "POST", "/api/plugins/reload");
    expect(res.status).toBe(200);
    expect(typeof (res.body as Record<string, unknown>).reloaded).toBe("number");
  });
});
