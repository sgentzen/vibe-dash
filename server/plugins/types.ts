import type { Router } from "express";
import type Database from "better-sqlite3";

export type PluginType = "mcp-tools" | "widget" | "integration";

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  type: PluginType;
  /** Path to the plugin's JS entrypoint, relative to the plugin directory */
  entrypoint?: string;
  /** For widget plugins: display label shown in the UI */
  label?: string;
  /** For widget plugins: default width in grid columns (1-4) */
  width?: number;
}

export interface PluginContext {
  /** Namespaced database access — tables are scoped to this plugin */
  db: Database.Database;
  /** Plugin's namespace prefix (e.g. "my-plugin") */
  namespace: string;
}

export interface PluginModule {
  /** Called once after the plugin is loaded */
  initialize?: (ctx: PluginContext) => void | Promise<void>;
  /** For integration plugins: return an Express Router to mount at /api/plugins/:name */
  router?: (ctx: PluginContext) => Router;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  module?: PluginModule;
  error?: string;
}
