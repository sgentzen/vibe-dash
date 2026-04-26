import { Router } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { loadPlugins } from "../plugins/loader.js";
import { createPluginContext } from "../plugins/sandbox.js";
import type { LoadedPlugin } from "../plugins/types.js";
import type { BroadcastFn, RouteFactory } from "./types.js";

// In-memory registry — populated at startup and refreshed on reload
let registry: LoadedPlugin[] = [];

export function getPluginRegistry(): LoadedPlugin[] {
  return registry;
}

export async function initPlugins(db: Database.Database): Promise<void> {
  registry = await loadPlugins(db);
}

const reloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

export const pluginRoutes: RouteFactory = (db: Database.Database, broadcast: BroadcastFn): Router => {
  const router = Router();

  /** GET /api/plugins — list all loaded plugins */
  router.get("/api/plugins", (_req, res) => {
    const list = registry.map(({ manifest, error }) => ({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? null,
      type: manifest.type,
      label: manifest.label ?? null,
      width: manifest.width ?? null,
      status: error ? "error" : "active",
      // Truncate error to avoid leaking full filesystem paths to the client
      error: error ? error.slice(0, 200) : null,
    }));
    res.json({ plugins: list });
  });

  /** POST /api/plugins/reload — reload all plugins from disk */
  router.post("/api/plugins/reload", reloadLimiter, async (_req, res) => {
    try {
      registry = await loadPlugins(db);
      broadcast({ type: "plugins_reloaded", payload: { count: registry.length } });
      res.json({ reloaded: registry.length });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Mount integration plugin routers at /api/plugins/:namespace
  // Note: sub-routers are mounted at startup only. Reloading updates the
  // registry (and the GET /api/plugins list) but does NOT remount routers;
  // a full server restart is required to pick up new integration routes.
  for (const plugin of registry) {
    if (plugin.manifest.type === "integration" && plugin.module?.router) {
      const ctx = createPluginContext(db, plugin.manifest.name);
      try {
        const subRouter = plugin.module.router(ctx);
        // Use the sanitized namespace (not the raw manifest name) as the URL segment
        router.use(`/api/plugins/${ctx.namespace}`, subRouter);
      } catch {
        // Skip plugins whose router factory throws
      }
    }
  }

  return router;
};
