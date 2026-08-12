import type Database from "better-sqlite3";

/** The resource attribute a user sets to bind their runner to a project. */
export const PROJECT_ATTRIBUTE = "vibe_dash.project";

/**
 * The project a set of resource attributes names, or null.
 *
 * OTLP carries no working directory, so unlike transcript ingestion there is
 * nothing to match against project_paths and nothing to infer from. A point
 * that names no project stays unattributed, which is the same visible
 * unresolved state as an unmatched transcript directory. Guessing here would
 * put real money against the wrong project with no way to notice.
 *
 * The attribute is matched as a project name first, then as an id, so a user
 * can write whichever they have to hand.
 */
export function resolveProjectId(
  db: Database.Database,
  resourceAttributes: Record<string, string>
): string | null {
  const named = resourceAttributes[PROJECT_ATTRIBUTE];
  if (!named) return null;

  const byName = db.prepare("SELECT id FROM projects WHERE name = ?").get(named) as { id: string } | undefined;
  if (byName) return byName.id;

  const byId = db.prepare("SELECT id FROM projects WHERE id = ?").get(named) as { id: string } | undefined;
  return byId ? byId.id : null;
}
