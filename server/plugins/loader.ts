// path.join/resolve inputs here are: the operator-controlled plugin directory
// (~/.vibe-dash/plugins by default), filesystem-listed entry names, and the
// manifest-declared entrypoint — which is explicitly verified to stay under
// resolvedPluginDir below. Not reachable from HTTP/MCP request data.
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import type Database from "better-sqlite3";
import type { PluginManifest, LoadedPlugin, PluginModule } from "./types.js";
import { createPluginContext } from "./sandbox.js";
import { logger } from "../logger.js";

const DEFAULT_PLUGIN_DIR = path.join(homedir(), ".vibe-dash", "plugins");
const MANIFEST_FILE = "plugin.json";

/** Discover and load all plugins from ~/.vibe-dash/plugins/ */
export async function loadPlugins(db: Database.Database): Promise<LoadedPlugin[]> {
  return loadPluginsFromDir(DEFAULT_PLUGIN_DIR, db);
}

/** Discover and load plugins from a specific directory (testable). */
export async function loadPluginsFromDir(dir: string, db: Database.Database): Promise<LoadedPlugin[]> {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const plugins: LoadedPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const loaded = await loadPluginFromEntry(path.join(dir, entry.name), entry.name, db);
    if (loaded) plugins.push(loaded);
  }

  return plugins;
}

// Loads a single plugin directory. Returns null when the directory has no
// manifest (not a plugin), or a LoadedPlugin — which carries an `error` field
// when the manifest/entrypoint/initialize step failed.
async function loadPluginFromEntry(
  pluginDir: string,
  fallbackName: string,
  db: Database.Database,
): Promise<LoadedPlugin | null> {
  const manifestPath = path.join(pluginDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;

  let manifest: PluginManifest;
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    manifest = parseManifest(JSON.parse(raw));
  } catch (err) {
    logger.warn({ dir: pluginDir, err }, "plugin manifest invalid — skipping");
    return { manifest: { name: fallbackName, version: "?", type: "widget" }, dir: pluginDir, error: String(err) };
  }

  let mod: PluginModule | undefined;
  if (manifest.entrypoint) {
    const entrypointPath = path.resolve(pluginDir, manifest.entrypoint);
    const resolvedPluginDir = path.resolve(pluginDir);
    if (!entrypointPath.startsWith(resolvedPluginDir + path.sep)) {
      const err = `entrypoint escapes plugin directory: ${manifest.entrypoint}`;
      logger.warn({ plugin: manifest.name }, err);
      return { manifest, dir: pluginDir, error: err };
    }
    try {
      const url = pathToFileURL(entrypointPath).href;
      mod = await import(url) as PluginModule;
    } catch (err) {
      logger.warn({ plugin: manifest.name, err }, "plugin entrypoint failed to load");
      return { manifest, dir: pluginDir, error: String(err) };
    }
  }

  if (mod?.initialize) {
    const ctx = createPluginContext(db, manifest.name);
    try {
      await mod.initialize(ctx);
    } catch (err) {
      logger.warn({ plugin: manifest.name, err }, "plugin initialize() threw");
      return { manifest, dir: pluginDir, module: mod, error: String(err) };
    }
  }

  logger.info({ plugin: manifest.name, type: manifest.type }, "plugin loaded");
  return { manifest, dir: pluginDir, module: mod };
}

function parseManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest must be an object");
  const m = raw as Record<string, unknown>;

  const name = requireString(m, "name");
  const version = requireString(m, "version");
  const type = requirePluginType(m);

  return {
    name,
    version,
    description: typeof m.description === "string" ? m.description : undefined,
    type,
    entrypoint: typeof m.entrypoint === "string" ? m.entrypoint : undefined,
    label: typeof m.label === "string" ? m.label : undefined,
    width: typeof m.width === "number" ? m.width : undefined,
  };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  if (typeof obj[key] !== "string" || !(obj[key]).trim()) {
    throw new Error(`plugin.json: "${key}" must be a non-empty string`);
  }
  return obj[key];
}

function requirePluginType(obj: Record<string, unknown>): PluginManifest["type"] {
  const valid = ["mcp-tools", "widget", "integration"];
  if (!valid.includes(obj.type as string)) {
    throw new Error(`plugin.json: "type" must be one of ${valid.join(", ")}`);
  }
  return obj.type as PluginManifest["type"];
}
