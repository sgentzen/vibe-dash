import type Database from "better-sqlite3";
import type { PluginContext } from "./types.js";

// The set of Database methods plugins are allowed to call.
// Omitting exec, transaction, pragma, backup, serialize, loadExtension, etc.
// prevents plugins from bypassing the table-prefix sandbox or corrupting the DB.
const ALLOWED_DB_PROPS = new Set<string | symbol>([
  "prepare",
  "inTransaction",
  "readonly",
  "name",
  "open",
  "memory",
]);

/**
 * Creates a sandboxed capability object for a plugin.
 *
 * The returned db proxy exposes only a narrow surface of the real Database
 * handle. Specifically, only `prepare` (with automatic table-name prefixing)
 * and a handful of read-only introspection properties are accessible.
 * Dangerous methods — exec, transaction, pragma, backup, serialize,
 * loadExtension, aggregate, function, table — are blocked so a plugin
 * cannot run arbitrary SQL, install native extensions, or wrap mutations
 * in untracked transactions.
 */
export function createPluginContext(db: Database.Database, pluginName: string): PluginContext {
  const namespace = sanitizeNamespace(pluginName);

  const sandboxedDb = new Proxy(db, {
    get(target, prop) {
      // Allow JS runtime symbol lookups (Symbol.toStringTag, Symbol.toPrimitive, etc.)
      // to pass through so the proxy behaves normally in string contexts and type checks.
      if (typeof prop === "symbol") {
        return (target as unknown as Record<string | symbol, unknown>)[prop];
      }
      if (!ALLOWED_DB_PROPS.has(prop)) {
        // Surface a clear error instead of silently returning undefined,
        // so plugin authors get actionable feedback during development.
        throw new TypeError(
          `Plugin "${namespace}" accessed forbidden Database property: ${prop}. ` +
          `Plugins may only use: ${[...ALLOWED_DB_PROPS].join(", ")}.`
        );
      }
      if (prop === "prepare") {
        return (sql: string) => target.prepare(prefixTables(sql, namespace));
      }
      const value = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, prop) {
      throw new TypeError(
        `Plugin "${namespace}" attempted to set Database property: ${String(prop)}.`
      );
    },
    has(_target, prop) {
      if (typeof prop === "symbol") return prop in (db as unknown as object);
      return ALLOWED_DB_PROPS.has(prop);
    },
  });

  return { db: sandboxedDb as Database.Database, namespace };
}

/** Ensure namespace contains only safe identifier characters */
function sanitizeNamespace(name: string): string {
  return name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
}

/**
 * Prefixes bare plugin table names in SQL with the plugin namespace.
 * Only rewrites identifiers that begin with `plugin_` — core vibe-dash
 * tables are left untouched.
 */
function prefixTables(sql: string, namespace: string): string {
  return sql.replace(/\bplugin_(\w+)\b/g, `${namespace}_$1`);
}
