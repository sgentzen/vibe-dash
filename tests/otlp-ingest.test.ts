import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { ingestMetricsPayload } from "../server/ingest/otlp/ingest.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

function codexPayload(opts: {
  tokens: Record<string, number>;
  cumulative?: boolean;
  time?: string;
  start?: string;
  project?: string;
  model?: string;
}): unknown {
  const resource = opts.project
    ? [{ key: "vibe_dash.project", value: { stringValue: opts.project } }]
    : [];
  return {
    resourceMetrics: [{
      resource: { attributes: resource },
      scopeMetrics: [{
        scope: { name: "codex" },
        metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: opts.cumulative
              ? "AGGREGATION_TEMPORALITY_CUMULATIVE"
              : "AGGREGATION_TEMPORALITY_DELTA",
            dataPoints: Object.entries(opts.tokens).map(([token_type, sum]) => ({
              attributes: [
                { key: "token_type", value: { stringValue: token_type } },
                { key: "model", value: { stringValue: opts.model ?? "gpt-5.3-codex" } },
              ],
              startTimeUnixNano: opts.start ?? "1000",
              timeUnixNano: opts.time ?? "2000",
              count: "1",
              sum,
            })),
          },
        }],
      }],
    }],
  };
}

function rows(db: Database.Database) {
  return db.prepare(
    `SELECT input_tokens, output_tokens, cost_usd, project_id, source, external_id
     FROM cost_entries ORDER BY created_at`
  ).all() as { input_tokens: number; output_tokens: number; cost_usd: number | null; project_id: string | null; source: string; external_id: string }[];
}

describe("ingestMetricsPayload", () => {
  it("writes one row per turn, not one per token type", () => {
    const result = ingestMetricsPayload(db, codexPayload({ tokens: { input: 100, output: 20 } }));

    expect(result.recorded).toBe(1);
    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0].input_tokens).toBe(100);
    expect(all[0].output_tokens).toBe(20);
    expect(all[0].source).toBe("otlp");
  });

  it("skips the total so figures are not doubled", () => {
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100, output: 20, total: 120 } }));

    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0].input_tokens).toBe(100);
    expect(all[0].output_tokens).toBe(20);
  });

  it("does not count the skipped total as unmapped, on an otherwise normal Codex payload", () => {
    // This is Finding 3's regression test. token_type="total" is a working-as-
    // designed skip of a metric this mapper DOES recognise, not a sign that
    // the runner is unrecognised. Before the fix, every one of these turns
    // incremented otlpUnmapped once per turn, forever, on a perfectly working
    // Codex setup -- exactly the false alarm otlpUnmapped must never raise.
    const result = ingestMetricsPayload(
      db,
      codexPayload({ tokens: { input: 100, output: 20, cached_input: 10, total: 130 } })
    );

    expect(result.unmapped).toBe(0);
  });

  it("writes no row and records nothing for a payload of only ignored points", () => {
    // Every point here is "ignored" (recognised metric, deliberately skipped
    // point), not "unmapped". A regression that let an ignored point slip
    // into a written row would hide behind a mapped row in the mixed test
    // above; this payload has no mapped point to hide behind.
    const result = ingestMetricsPayload(db, codexPayload({ tokens: { total: 100 } }));

    expect(result.recorded).toBe(0);
    expect(result.unmapped).toBe(0);
    expect(rows(db)).toHaveLength(0);
  });

  it("counts an ignored point and an unmapped point separately in the same payload", () => {
    // The exact cross-contamination case Finding 3 exists to prevent: an
    // "ignored" point (Codex's total, metric recognised) sitting alongside a
    // genuinely "unmapped" point (a metric no mapper reads at all) in ONE
    // payload must move only the unmapped counter, and by exactly one -- not
    // two, which is what conflating the two statuses would produce.
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [
          {
            scope: { name: "codex" },
            metrics: [{
              name: "codex.turn.token_usage",
              histogram: {
                aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
                dataPoints: [{
                  attributes: [
                    { key: "token_type", value: { stringValue: "total" } },
                    { key: "model", value: { stringValue: "gpt-5.3-codex" } },
                  ],
                  startTimeUnixNano: "1000",
                  timeUnixNano: "2000",
                  count: "1",
                  sum: 100,
                }],
              },
            }],
          },
          {
            scope: { name: "some-other-runner" },
            metrics: [{
              name: "some_other_runner.turn.token_usage",
              histogram: {
                aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
                dataPoints: [{ attributes: [], startTimeUnixNano: "1000", timeUnixNano: "2000", sum: 42 }],
              },
            }],
          },
        ],
      }],
    };

    const result = ingestMetricsPayload(db, payload);

    expect(result.unmapped).toBe(1);
    expect(result.recorded).toBe(0);
    expect(rows(db)).toHaveLength(0);
  });

  it("records a cumulative series as increments, not running totals", () => {
    // THE test of this feature. Three exports of a climbing total must record
    // 100, then 50, then 30 — not 100, 150, 180, which is what recording the
    // value instead of the increase would produce.
    const at = (time: string, input: number) =>
      ingestMetricsPayload(db, codexPayload({ tokens: { input }, cumulative: true, time }));

    at("2000", 100);
    at("3000", 150);
    at("4000", 180);

    expect(rows(db).map((r) => r.input_tokens)).toEqual([100, 50, 30]);
  });

  it("records a delta series as sent", () => {
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, time: "2000" }));
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, time: "3000" }));

    expect(rows(db).map((r) => r.input_tokens)).toEqual([100, 100]);
  });

  it("is idempotent: replaying an export changes nothing", () => {
    const payload = codexPayload({ tokens: { input: 100, output: 20 } });
    ingestMetricsPayload(db, payload);
    ingestMetricsPayload(db, payload);

    expect(rows(db)).toHaveLength(1);
  });

  it("counts a Claude Code payload as unmapped and writes no rows", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "claude-code" }, metrics: [{
          name: "claude_code.token.usage",
          sum: {
            aggregationTemporality: 1,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", asInt: "500" }],
          },
        }] }],
      }],
    };

    const result = ingestMetricsPayload(db, payload);
    expect(result.recorded).toBe(0);
    expect(result.unmapped).toBe(1);
    expect(rows(db)).toHaveLength(0);
  });

  it("attributes to a project named by the resource attribute", () => {
    const project = createProject(db, { name: "demo", description: null });
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, project: "demo" }));

    expect(rows(db)[0].project_id).toBe(project.id);
  });

  it("attributes by project id as well as by name", () => {
    const project = createProject(db, { name: "demo", description: null });
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, project: project.id }));

    expect(rows(db)[0].project_id).toBe(project.id);
  });

  it("records with no project rather than guessing, and counts it", () => {
    const result = ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 } }));

    expect(result.unattributed).toBe(1);
    expect(rows(db)[0].project_id).toBeNull();
  });

  it("stores an unknown model unpriced rather than free", () => {
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, model: "not-a-real-model" }));

    expect(rows(db)[0].cost_usd).toBeNull();
  });

  it("produces a real cost figure for a priced model", () => {
    // The feature's whole promise: a Codex user sees what they spent. Every
    // other test here would pass with pricing entirely broken, because they
    // assert on token counts. This one would not.
    // gpt-5.3-codex is $1.75/MTok input, so 1,000,000 input tokens is $1.75.
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 1_000_000 } }));

    expect(rows(db)[0].cost_usd).toBeCloseTo(1.75, 6);
  });

  // --- Additional coverage beyond the brief's verbatim test set, added
  // during code review to close gaps the reviewers flagged directly against
  // this task's stated invariants (the sorted-key hash and the grouping
  // logic in particular). None of the tests above were altered.

  it("hashes to the same idempotency key regardless of resource attribute order", () => {
    // sortedReplacer (ingest.ts) exists specifically so two payloads naming
    // the same resource attributes in a different key order produce the same
    // external_id. OTLP exporters make no promise about attribute order, so
    // without this a reordered re-export of the same turn would be recorded
    // twice.
    const dataPoint = {
      attributes: [
        { key: "token_type", value: { stringValue: "input" } },
        { key: "model", value: { stringValue: "gpt-5.3-codex" } },
      ],
      startTimeUnixNano: "1000",
      timeUnixNano: "2000",
      count: "1",
      sum: 100,
    };
    const payloadWithAttrs = (attrs: { key: string; value: { stringValue: string } }[]) => ({
      resourceMetrics: [{
        resource: { attributes: attrs },
        scopeMetrics: [{
          scope: { name: "codex" },
          metrics: [{
            name: "codex.turn.token_usage",
            histogram: { aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA", dataPoints: [dataPoint] },
          }],
        }],
      }],
    });

    ingestMetricsPayload(db, payloadWithAttrs([
      { key: "vibe_dash.project", value: { stringValue: "demo" } },
      { key: "team", value: { stringValue: "infra" } },
    ]));
    ingestMetricsPayload(db, payloadWithAttrs([
      { key: "team", value: { stringValue: "infra" } },
      { key: "vibe_dash.project", value: { stringValue: "demo" } },
    ]));

    expect(rows(db)).toHaveLength(1);
  });

  it("keeps distinct turns in a single payload separate", () => {
    // Two turns that differ only in timeUnixNano, sent in ONE call, must stay
    // two rows: a bug that dropped timeUnixNano from the group key would
    // silently merge their token counts into one.
    const turn = (timeUnixNano: string, sum: number) => ({
      attributes: [
        { key: "token_type", value: { stringValue: "input" } },
        { key: "model", value: { stringValue: "gpt-5.3-codex" } },
      ],
      startTimeUnixNano: "1000",
      timeUnixNano,
      count: "1",
      sum,
    });
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{
          scope: { name: "codex" },
          metrics: [{
            name: "codex.turn.token_usage",
            histogram: {
              aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
              dataPoints: [turn("2000", 100), turn("3000", 50)],
            },
          }],
        }],
      }],
    };

    const result = ingestMetricsPayload(db, payload);

    expect(result.recorded).toBe(2);
    expect(rows(db).map((r) => r.input_tokens).sort((a, b) => a - b)).toEqual([50, 100]);
  });

  it("counts mapped and unmapped points separately within one payload", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [
          {
            scope: { name: "codex" },
            metrics: [{
              name: "codex.turn.token_usage",
              histogram: {
                aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
                dataPoints: [{
                  attributes: [
                    { key: "token_type", value: { stringValue: "input" } },
                    { key: "model", value: { stringValue: "gpt-5.3-codex" } },
                  ],
                  startTimeUnixNano: "1000",
                  timeUnixNano: "2000",
                  count: "1",
                  sum: 100,
                }],
              },
            }],
          },
          {
            scope: { name: "claude-code" },
            metrics: [{
              name: "claude_code.token.usage",
              sum: {
                aggregationTemporality: 1,
                dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", asInt: "500" }],
              },
            }],
          },
        ],
      }],
    };

    const result = ingestMetricsPayload(db, payload);

    expect(result.recorded).toBe(1);
    expect(result.unmapped).toBe(1);
    expect(rows(db)).toHaveLength(1);
  });

  it("records with no project when the named attribute matches no project", () => {
    const result = ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, project: "does-not-exist" }));

    expect(result.unattributed).toBe(1);
    expect(rows(db)[0].project_id).toBeNull();
  });

  it("prices cache-read tokens at the cache-read rate", () => {
    // cached_input maps to cacheRead (mappers/codex.ts). cacheRead is priced
    // and then dropped (no column for it), so this is the only place a
    // regression to "cacheReadTokens always 0" in the write path would show.
    // gpt-5.3-codex input rate is $1.75/MTok; cache reads are 10% of that, so
    // 1,000,000 cached_input tokens is $0.175.
    ingestMetricsPayload(db, codexPayload({ tokens: { cached_input: 1_000_000 } }));

    expect(rows(db)[0].cost_usd).toBeCloseTo(0.175, 6);
  });

  it("propagates a malformed payload's parse failure rather than swallowing it", () => {
    // parseMetricsPayload (parse.ts) throws for a non-object body. Whether
    // that throw reaches the caller matters to the route this feeds: an
    // uncaught throw becomes a 500 rather than a handled 400, so the
    // behaviour needs to be pinned down rather than left implicit.
    expect(() => ingestMetricsPayload(db, "not an object")).toThrow();
  });
});
