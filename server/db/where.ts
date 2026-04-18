/**
 * Build a SQL WHERE clause from a list of conditional entries.
 *
 * Each entry is either:
 *   - A tuple `[condition: string, value: unknown]` — always included, value pushed as param.
 *   - A tuple `[condition: string, value: unknown, include: boolean]` — included only when `include` is true.
 *   - `null` / `undefined` / `false` — skipped.
 *
 * Returns `{ sql, params }` where `sql` is either `""` (no conditions) or
 * `"WHERE <cond1> AND <cond2> ..."`.
 */
export type WhereClause =
  | [condition: string, value: unknown]
  | [condition: string, value: unknown, include: boolean]
  | null
  | undefined
  | false;

export function buildWhere(clauses: WhereClause[]): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const entry of clauses) {
    if (!entry) continue;
    if (entry.length === 3 && !entry[2]) continue;
    conditions.push(entry[0]);
    params.push(entry[1]);
  }
  if (conditions.length === 0) return { sql: "", params };
  return { sql: "WHERE " + conditions.join(" AND "), params };
}
