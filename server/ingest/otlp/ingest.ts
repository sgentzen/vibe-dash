import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { parseMetricsPayload } from "./parse.js";
import { mapPoint } from "./mappers/index.js";
import { seriesIncrement } from "./series.js";
import { resolveProjectId } from "./attribute.js";
import { priceTokens } from "../transcripts/pricing.js";
import { logger } from "../../logger.js";
import type { OtlpPoint } from "./types.js";

const PROVIDER = "openai";

export interface IngestResult {
  recorded: number;
  unmapped: number;
  unattributed: number;
}

// Process-lifetime, not a query — an unmapped point writes no row, so unlike
// otlpRows/otlpUnattributed (which read cost_entries) there is no table to
// count it from. This resets on restart, which is a real, weaker guarantee
// than the other status counters: fine for "is my runner recognised right
// now", not fine for anything that needs to survive a restart.
let unmappedPoints = 0;

/** Read the process-lifetime count of OTLP points no mapper recognised. */
export function unmappedPointCount(): number {
  return unmappedPoints;
}

/** One turn's worth of grouped token counts, still unpriced and unattributed. */
interface Group {
  model: string;
  resourceAttributes: Record<string, string>;
  timeUnixNano: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Stable hash of everything that identifies one series, EXCEPT its start time. */
function seriesKey(point: OtlpPoint): string {
  return hash([point.metricName, point.scopeName, point.resourceAttributes, point.attributes]);
}

/** Stable hash of one turn, merging the token_type dimension the grouping folds away. */
function groupKey(point: OtlpPoint, model: string): string {
  return hash([point.metricName, point.scopeName, point.resourceAttributes, model]);
}

function hash(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts, sortedReplacer)).digest("hex").slice(0, 32);
}

/** Object key order must not change a hash, so keys are sorted on the way in. */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  return value;
}

/**
 * How much of this point's value is new spend.
 *
 * A delta point already describes an interval and contributes its value
 * directly. A cumulative point contributes only what has moved since the
 * last export of its series (`seriesIncrement`, series.ts) — the point's own
 * attributes, including token_type, are folded into the series key, so each
 * token kind's running total is tracked as its own series even though the
 * rows they produce are later grouped back together.
 */
function resolveQuantity(db: Database.Database, point: OtlpPoint): number {
  if (!point.cumulative) return point.value;
  return seriesIncrement(db, seriesKey(point), point.startTimeUnixNano, point.value);
}

/**
 * Whether a group's accumulated total has grown past what can be faithfully
 * represented as an integer token count.
 *
 * `boundedOrNull` (parse.ts) bounds each POINT to [0, MAX_SAFE_INTEGER], but
 * `accumulate` sums many in-bound points into one group with no ceiling of
 * its own: enough points sharing a (metric, model, timeUnixNano) group key
 * can sum past MAX_SAFE_INTEGER even though every point that fed them
 * individually passed the per-point bound. The same reasoning applies here as
 * there: beyond MAX_SAFE_INTEGER the total is not a number that can be
 * represented exactly, so it is not one we can honestly record, whatever its
 * provenance. The group is rejected outright rather than clamped to the
 * maximum -- clamping would record a fabricated figure in place of a refused
 * one, and because no cost row is ever deleted, that fabrication would be
 * permanent.
 */
function groupExceedsSafeBound(group: Group): boolean {
  return (
    group.inputTokens > Number.MAX_SAFE_INTEGER ||
    group.outputTokens > Number.MAX_SAFE_INTEGER ||
    group.cacheReadTokens > Number.MAX_SAFE_INTEGER
  );
}

/** Fold one point's quantity into its turn's group, creating the group on first sight. */
function accumulate(
  groups: Map<string, Group>,
  key: string,
  point: OtlpPoint,
  model: string,
  kind: "input" | "output" | "cacheRead",
  quantity: number
): void {
  const group = groups.get(key) ?? {
    model,
    resourceAttributes: point.resourceAttributes,
    timeUnixNano: point.timeUnixNano,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };

  if (kind === "input") group.inputTokens += quantity;
  else if (kind === "output") group.outputTokens += quantity;
  else group.cacheReadTokens += quantity;

  groups.set(key, group);
}

/**
 * Map, price-resolve and group every point in a payload into one entry per
 * turn.
 *
 * Split out of `ingestMetricsPayload` so the reduce phase and the write phase
 * are each small enough to read on their own (and to keep SonarCloud's
 * cognitive-complexity check quiet).
 */
function buildGroups(
  db: Database.Database,
  points: OtlpPoint[]
): { groups: Map<string, Group>; unmapped: number } {
  const groups = new Map<string, Group>();
  let unmapped = 0;

  for (const point of points) {
    const result = mapPoint(point);

    // "unmapped": no mapper recognised this metric name -- the one thing
    // otlpUnmapped exists to surface (spec §7). "ignored": a mapper DID
    // recognise the metric but deliberately skipped this point (Codex's
    // token_type="total", a point with no model) -- working as designed, and
    // must not inflate the same counter that answers "is my runner
    // recognised?". See MapResult (types.ts) for why these are kept distinct.
    if (result.status === "unmapped") {
      unmapped++;
      unmappedPoints++;
      continue;
    }
    if (result.status === "ignored") continue;

    const mapped = result.usage;

    // A cumulative point that has not moved yields zero. Writing a zero row
    // would inflate entry_count with a row that carries no new spend.
    const quantity = resolveQuantity(db, point);
    if (quantity <= 0) continue;

    const key = `${groupKey(point, mapped.model)}:${point.timeUnixNano}`;
    accumulate(groups, key, point, mapped.model, mapped.kind, quantity);
  }

  return { groups, unmapped };
}

/** Price, attribute and insert one group's row. Returns whether it was newly recorded. */
function writeGroup(
  db: Database.Database,
  key: string,
  group: Group
): { recorded: boolean; unattributed: boolean } {
  // Cache-read tokens are priced and then dropped, exactly as transcript
  // ingestion already does, because cost_entries has no column for them.
  const cost = priceTokens({
    model: group.model,
    speed: null,
    inputTokens: group.inputTokens,
    outputTokens: group.outputTokens,
    cacheReadTokens: group.cacheReadTokens,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  });

  const projectId = resolveProjectId(db, group.resourceAttributes);

  // created_at is OUR clock. The point's timeUnixNano (the exporter's clock)
  // is used only in the external_id below, never here — mixing the two in a
  // column the dashboard groups spend by day would misplace spend when the
  // clocks disagree.
  const result = db.prepare(
    `INSERT OR IGNORE INTO cost_entries
       (id, agent_id, task_id, milestone_id, project_id, model, provider,
        input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'otlp', ?)`
  ).run(
    randomUUID(),
    projectId,
    group.model,
    PROVIDER,
    group.inputTokens,
    group.outputTokens,
    cost,
    new Date().toISOString(),
    `otlp:${key}`
  );

  return { recorded: result.changes > 0, unattributed: projectId === null };
}

/**
 * Turn one OTLP/JSON ExportMetricsServiceRequest into priced, attributed cost
 * rows.
 *
 * The pipeline is parse, then reduce points into one row per turn (Codex
 * sends four points per turn, one per token_type, and writing four rows
 * would inflate entry_count fourfold), then write. Idempotency is enforced
 * by the database, via the partial unique index on cost_entries.external_id,
 * never by application logic — a replayed export inserts nothing and
 * `recorded` reports zero for it rather than claiming work it did not do.
 *
 * Grouping and writing both run inside ONE transaction. `buildGroups` itself
 * writes to `otlp_series` (via `seriesIncrement`), so if that stayed outside
 * the transaction a failure partway through the write loop would leave the
 * series store advanced with no corresponding cost row — an unrecoverable
 * silent loss of the difference on the next export. Wrapping both phases
 * together means a malformed group really can't half-apply, series state
 * included.
 */
export function ingestMetricsPayload(db: Database.Database, body: unknown): IngestResult {
  const points = parseMetricsPayload(body);

  let recorded = 0;
  let unattributed = 0;
  let unmapped = 0;

  db.transaction(() => {
    const built = buildGroups(db, points);
    unmapped = built.unmapped;

    for (const [key, group] of built.groups) {
      // Reject before pricing or inserting: an unbounded group total must
      // never reach priceTokens or the INSERT, since a fabricated cost row is
      // permanent (no cost row is ever deleted). See groupExceedsSafeBound.
      if (groupExceedsSafeBound(group)) {
        logger.warn(
          {
            key,
            model: group.model,
            resourceAttributes: group.resourceAttributes,
            timeUnixNano: group.timeUnixNano,
            inputTokens: group.inputTokens,
            outputTokens: group.outputTokens,
            cacheReadTokens: group.cacheReadTokens,
          },
          "OTLP group total exceeds MAX_SAFE_INTEGER and cannot be faithfully recorded; skipping the whole group"
        );
        continue;
      }

      const result = writeGroup(db, key, group);
      if (result.recorded) recorded++;
      if (result.unattributed) unattributed++;
    }
  })();

  return { recorded, unmapped, unattributed };
}
