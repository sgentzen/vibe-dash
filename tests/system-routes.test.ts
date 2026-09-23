import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import express from "express";
import type { Express } from "express";
import { createTestDb } from "./setup.js";
import { systemRoutes } from "../server/routes/system.js";
import { errorHandler } from "../server/routes/middleware.js";
import { requestApp } from "./http-helper.js";
import { version as pkgVersion } from "../server/version.js";

let db: Database.Database;
let app: Express;

function request(method: string, path: string, body?: unknown) {
  return requestApp(app, method, path, body);
}

/** Mounts the routes fresh — needed per-test because schemaDrift is computed
 * once when systemRoutes() is called, not per request (see server/routes/system.ts). */
function mountApp(): void {
  app = express();
  app.use(express.json());
  app.use(systemRoutes(db, () => {}));
  app.use(errorHandler);
}

beforeEach(() => {
  db = createTestDb();
  mountApp();
});

describe("GET /api/health", () => {
  it("keeps ok: true for every existing caller (backwards compatible)", async () => {
    const res = await request("GET", "/api/health");
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it("reports the running build's version, commit and buildTime", async () => {
    const res = await request("GET", "/api/health");
    const body = res.body as { version: string; commit: string; buildTime: string };
    // The version comes straight from package.json in this checkout, so it
    // should match exactly rather than merely "be a string" — a wrong
    // resolveDistDir-style path fallback would otherwise silently read
    // "unknown" and this test would still pass with a weaker assertion.
    expect(body.version).toBe(pkgVersion);
    expect(typeof body.commit).toBe("string");
    expect(typeof body.buildTime).toBe("string");
  });

  it("omits schemaDrift when the database carries no unknown migrations", async () => {
    const res = await request("GET", "/api/health");
    expect(res.body).not.toHaveProperty("schemaDrift");
  });

  it("reports schemaDrift when the database records a migration this build doesn't know", async () => {
    // The only way this can happen at runtime is VIBE_DASH_ALLOW_SCHEMA_DRIFT
    // having let such a database open in the first place (runMigrations()
    // otherwise refuses to start) — simulated directly here rather than via
    // env var + real startup, which migrator.test.ts already covers for the
    // guard itself.
    //
    // Inserted before re-mounting the app, not after: schemaDrift is read
    // once when systemRoutes(db, ...) is called (a security-review fix so
    // /api/health does no per-request DB work — see the route's own
    // comment), so a row inserted after mountApp() would never be seen.
    db.prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)").run(
      "999_from_the_future", new Date().toISOString()
    );
    mountApp();
    const res = await request("GET", "/api/health");
    expect((res.body as { schemaDrift: string[] }).schemaDrift).toEqual(["999_from_the_future"]);
  });
});
