import type { MapResult, MappedUsage, OtlpPoint } from "../types.js";

const METRIC = "codex.turn.token_usage";

/**
 * Codex reports each turn's tokens split by `token_type`.
 *
 * `total` is deliberately absent from this table. It arrives ALONGSIDE the
 * components rather than instead of them, so counting it as well would double
 * every Codex figure. Skipping it is therefore an "ignored" result below, not
 * "unmapped": the metric IS `codex.turn.token_usage`, which this mapper
 * recognises, so a working Codex setup sending `total` every turn must not
 * move the counter that exists to flag an UNrecognised runner.
 *
 * `reasoning_output` maps to output because that is how it is billed, not
 * because of the name. `cached_input` maps to cache reads, which are priced at
 * a fraction of the input rate.
 */
const TOKEN_KINDS: Record<string, MappedUsage["kind"]> = {
  input: "input",
  output: "output",
  cached_input: "cacheRead",
  reasoning_output: "output",
};

/**
 * Recognise a Codex token-usage point.
 *
 * Returns "unmapped" only when the metric name itself is not
 * `codex.turn.token_usage` -- the case that means this point's runner is not
 * recognised. Every other skip below (an unrecognised or absent token_type,
 * a missing model) is "ignored": the metric name matched, so this is a
 * deliberate per-point decision within a runner we DO support, and must not
 * be counted the same as an unrecognised runner (see MapResult, types.ts).
 */
export function mapCodexPoint(point: OtlpPoint): MapResult {
  if (point.metricName !== METRIC) return { status: "unmapped" };

  // Object.hasOwn, not a bare lookup: attributes come off the wire, and a
  // token_type of "constructor" or "toString" would otherwise resolve to an
  // inherited Object.prototype member. That member is truthy, so the guard
  // below would pass and the point would map with a kind that is a function.
  const tokenType = point.attributes.token_type ?? "";
  const kind = Object.hasOwn(TOKEN_KINDS, tokenType) ? TOKEN_KINDS[tokenType] : undefined;
  if (!kind) return { status: "ignored" };

  // No model means no rate, and guessing one would put a wrong number in the
  // money path. The metric is still recognised, so this is "ignored", not
  // "unmapped".
  const model = point.attributes.model;
  if (!model) return { status: "ignored" };

  return { status: "mapped", usage: { model, kind } };
}
