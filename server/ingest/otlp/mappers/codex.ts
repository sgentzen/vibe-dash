import type { MappedUsage, OtlpPoint } from "../types.js";

const METRIC = "codex.turn.token_usage";

/**
 * Codex reports each turn's tokens split by `token_type`.
 *
 * `total` is deliberately absent from this table. It arrives ALONGSIDE the
 * components rather than instead of them, so counting it as well would double
 * every Codex figure.
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

/** Recognise a Codex token-usage point, or return null to leave it unmapped. */
export function mapCodexPoint(point: OtlpPoint): MappedUsage | null {
  if (point.metricName !== METRIC) return null;

  const kind = TOKEN_KINDS[point.attributes.token_type ?? ""];
  if (!kind) return null;

  // No model means no rate, and guessing one would put a wrong number in the
  // money path. Leaving it unmapped keeps it visible in the unmapped count.
  const model = point.attributes.model;
  if (!model) return null;

  return { model, kind };
}
