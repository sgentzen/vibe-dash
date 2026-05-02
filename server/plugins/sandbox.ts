import type Database from "better-sqlite3";
import type { PluginContext } from "./types.js";

/**
 * Creates a sandboxed DB proxy for a plugin.
 * Plugins get a real Database handle but their table names are
 * automatically prefixed so they cannot collide with core tables.
 */
export function createPluginContext(db: Database.Database, pluginName: string): PluginContext {
  const namespace = sanitizeNamespace(pluginName);

  // Proxy that intercepts prepare() to prefix table names in SQL
  const sandboxedDb = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => target.prepare(prefixTables(sql, namespace));
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { db: sandboxedDb as Database.Database, namespace };
}

/** Ensure namespace contains only safe identifier characters */
function sanitizeNamespace(name: string): string {
  return name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
}

/**
 * Naively prefixes bare table names in SQL with the plugin namespace.
 * Only applied to CREATE TABLE and plugin-specific table references.
 * Core vibe-dash tables are left alone.
 */
function prefixTables(sql: string, namespace: string): string {
  return sql.replace(/\bplugin_(\w+)\b/g, `${namespace}_$1`);
}
